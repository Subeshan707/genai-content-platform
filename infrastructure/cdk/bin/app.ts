#!/usr/bin/env node
/**
 * GenAI Content Platform — CDK Event Wiring
 * EventBridge, SQS → Lambda, S3 → EventBridge
 */
import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

class GenAIEventWiringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const env = this.node.tryGetContext('environment') || 'dev';
    const projectName = 'genai-platform';

    // ── Import existing resources ─────────────────────────
    const brandDocsBucket = s3.Bucket.fromBucketName(
      this, 'BrandDocs', `${projectName}-brand-docs`
    );

    const mediaAssetsBucket = s3.Bucket.fromBucketName(
      this, 'MediaAssets', `${projectName}-media-assets`
    );

    const imageGenerateQueue = sqs.Queue.fromQueueArn(
      this, 'ImageGenQueue',
      `arn:aws:sqs:${this.region}:${this.account}:${projectName}-image-generate`
    );

    // ── EventBridge Event Bus ─────────────────────────────
    const eventBus = new events.EventBus(this, 'GenAIEventBus', {
      eventBusName: `${projectName}-events`,
    });

    // ── Lambda: S3 Brand Doc Upload → Trigger Ingestion ──
    const ingestTriggerLambda = new lambda.Function(this, 'IngestTrigger', {
      functionName: `${projectName}-ingest-trigger`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
import json
import boto3
import os

sqs = boto3.client('sqs')
QUEUE_URL = os.environ['INGEST_QUEUE_URL']

def handler(event, context):
    for record in event['Records']:
        bucket = record['s3']['bucket']['name']
        key = record['s3']['object']['key']
        
        # Extract workspace_id from key: brand-docs/{workspace_id}/...
        parts = key.split('/')
        workspace_id = parts[1] if len(parts) > 1 else 'unknown'
        
        message = {
            'workspace_id': workspace_id,
            's3_key': key,
            'document_name': parts[-1] if parts else key,
            'bucket': bucket,
        }
        
        sqs.send_message(
            QueueUrl=QUEUE_URL,
            MessageBody=json.dumps(message),
            MessageGroupId=f'ingest-{workspace_id}',
            MessageDeduplicationId=f'{key}-{record["eventTime"]}',
        )
        
        print(f'Queued ingestion: workspace={workspace_id}, key={key}')
    
    return {'statusCode': 200}
      `),
      environment: {
        INGEST_QUEUE_URL: `https://sqs.${this.region}.amazonaws.com/${this.account}/${projectName}-content-ingest.fifo`,
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
    });

    // Grant SQS send permissions
    ingestTriggerLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sqs:SendMessage'],
      resources: [`arn:aws:sqs:${this.region}:${this.account}:${projectName}-content-ingest.fifo`],
    }));

    // S3 → Lambda trigger on brand doc upload
    brandDocsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(ingestTriggerLambda),
      { prefix: 'brand-docs/' }
    );

    // ── Lambda: Image Generation SQS Consumer ────────────
    const imageGenLambda = new lambda.Function(this, 'ImageGenConsumer', {
      functionName: `${projectName}-image-gen-consumer`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
import json
import boto3
import base64
import os
import uuid

bedrock = boto3.client('bedrock-runtime', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
s3_client = boto3.client('s3')
MEDIA_BUCKET = os.environ['MEDIA_BUCKET']

def handler(event, context):
    for record in event['Records']:
        body = json.loads(record['body'])
        
        prompt = body['prompt']
        piece_id = body['piece_id']
        workspace_id = body['workspace_id']
        width = body.get('width', 1024)
        height = body.get('height', 1024)
        
        # Generate image with Titan Image Generator (FREE TIER: 500/month)
        response = bedrock.invoke_model(
            modelId='amazon.titan-image-generator-v1',
            body=json.dumps({
                'taskType': 'TEXT_IMAGE',
                'textToImageParams': {'text': prompt},
                'imageGenerationConfig': {
                    'numberOfImages': 1,
                    'width': width,
                    'height': height,
                    'cfgScale': 8.0,
                },
            }),
        )
        
        result = json.loads(response['body'].read())
        images = result.get('images', [])
        
        for i, img_b64 in enumerate(images):
            img_bytes = base64.b64decode(img_b64)
            s3_key = f'generated/{workspace_id}/{piece_id}/{uuid.uuid4()}.png'
            
            s3_client.put_object(
                Bucket=MEDIA_BUCKET,
                Key=s3_key,
                Body=img_bytes,
                ContentType='image/png',
            )
            
            print(f'Image saved: s3://{MEDIA_BUCKET}/{s3_key}')
    
    return {'statusCode': 200}
      `),
      environment: {
        MEDIA_BUCKET: mediaAssetsBucket.bucketName,
      },
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
    });

    // Grant Bedrock + S3 permissions
    imageGenLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['arn:aws:bedrock:*::foundation-model/amazon.titan-image-generator-v1'],
    }));
    mediaAssetsBucket.grantPut(imageGenLambda);

    // SQS → Lambda event source
    imageGenLambda.addEventSource(new eventsources.SqsEventSource(
      sqs.Queue.fromQueueArn(this, 'ImageGenQueueSource',
        `arn:aws:sqs:${this.region}:${this.account}:${projectName}-image-generate`
      ),
      { batchSize: 1 }
    ));

    // ── Lambda: Transcribe Job Completion ─────────────────
    const transcribeCompleteLambda = new lambda.Function(this, 'TranscribeComplete', {
      functionName: `${projectName}-transcribe-complete`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
import json
import boto3
import os

def handler(event, context):
    detail = event.get('detail', {})
    job_name = detail.get('TranscriptionJobName', '')
    status = detail.get('TranscriptionJobStatus', '')
    
    print(f'Transcription job completed: {job_name}, status: {status}')
    
    if status == 'COMPLETED':
        # TODO: Fetch transcript, update MongoDB locale variant with subtitles
        print(f'Processing completed transcript for job: {job_name}')
    elif status == 'FAILED':
        print(f'Transcription failed for job: {job_name}')
    
    return {'statusCode': 200}
      `),
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
    });

    // EventBridge rule for Transcribe job completion
    new events.Rule(this, 'TranscribeCompleteRule', {
      eventBus: events.EventBus.fromEventBusName(this, 'DefaultBus', 'default'),
      ruleName: `${projectName}-transcribe-complete`,
      eventPattern: {
        source: ['aws.transcribe'],
        detailType: ['Transcribe Job State Change'],
        detail: {
          TranscriptionJobStatus: ['COMPLETED', 'FAILED'],
        },
      },
      targets: [new targets.LambdaFunction(transcribeCompleteLambda)],
    });

    // ── EventBridge: Content Approved → Fan-out ──────────
    new events.Rule(this, 'ContentApprovedRule', {
      eventBus,
      ruleName: `${projectName}-content-approved`,
      eventPattern: {
        source: ['genai.core-service'],
        detailType: ['ContentApproved'],
      },
      targets: [
        // Fan-out to localization and image generation
        new targets.SqsQueue(
          sqs.Queue.fromQueueArn(this, 'LocalizeTarget',
            `arn:aws:sqs:${this.region}:${this.account}:${projectName}-localize.fifo`
          )
        ),
      ],
    });

    // ── Outputs ───────────────────────────────────────────
    new cdk.CfnOutput(this, 'EventBusArn', { value: eventBus.eventBusArn });
  }
}

const app = new cdk.App();
new GenAIEventWiringStack(app, 'GenAIEventWiring', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
});
