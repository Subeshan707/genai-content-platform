# GenAI Content Creation Platform

AI-powered content scripting, translation, subtitle generation, asset creation, and CMS publishing in one workflow. Built on AWS managed services and Bedrock free-tier models.

## Table of contents
- Overview
- Features
- Architecture
- AI models (free tier)
- Tech stack
- Repository structure
- Quick start (local)
- Environment variables
- Core value loop
- RBAC roles
- Infrastructure highlights
- CI/CD
- Security
- Cost optimization
- License

## Overview
The platform streamlines end-to-end content creation for teams. It provides AI-assisted drafting, human editing, localization, asset generation, and publishing to external CMS targets with auditability and role-based access.

## Features
- Unified content workflow from brief to publish
- Multi-agent AI orchestration with streaming responses
- Localization and transcription services
- Brand voice RAG with vector search
- CMS integrations via queued jobs
- RBAC, audit logging, and security guardrails

## Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                         CloudFront CDN                          │
│                     (React SPA + S3 Origin)                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                      AWS ALB (WAF Protected)                    │
│              /api/* -> Core Service    /ai/* -> AI Service      │
└────────┬───────────────────────────────────────────┬────────────┘
         │                                           │
┌────────▼────────────┐                  ┌───────────▼────────────┐
│   Spring Boot 3.2   │                  │     FastAPI (Python)   │
│   (Core Service)    │                  │     (AI Service)       │
│                     │                  │                        │
│ - Cognito JWT Auth  │  <- SQS  ----->  │ - Bedrock Converse API │
│ - RBAC (4 roles)    │                  │ - Strand Orchestrator  │
│ - CMS Integration   │                  │ - Brand RAG (pgvector) │
│ - Audit Logging     │                  │ - Amazon Translate     │
│ - S3 Presign URLs   │                  │ - Amazon Transcribe    │
│ - SQS Queueing      │                  │ - Titan Image Gen      │
└────────┬────────────┘                  └───────────┬────────────┘
         │                                           │
┌────────▼───────────────────────────────────────────▼────────────┐
│                        Data Layer                               │
│  Aurora PostgreSQL v2     DocumentDB        ElastiCache Redis   │
│  (+ pgvector + RDS Proxy) (Locale variants)  (Embed cache)     │
└─────────────────────────────────────────────────────────────────┘
```

## AI models (free tier)
| Model | Service | Free tier limit |
|-------|---------|-----------------|
| Llama 3.1 8B Instruct | Bedrock Converse | 1,000 input + 1,000 output units |
| Amazon Titan Text Lite | Bedrock Converse | 300M tokens for 12 months |
| Amazon Titan Embed V2 | Bedrock | 1,000 units/month |
| Amazon Titan Image Gen | Bedrock | 500 images/month |
| Amazon Translate | AWS | 2M chars/month for 12 months |
| Amazon Transcribe | AWS | 60 minutes/month for 12 months |

No paid third-party APIs are used. No OpenAI, no Anthropic direct, no DeepL paid, no Midjourney.

## Tech stack
| Layer | Tech |
|------|------|
| Frontend | React 18, Vite, TypeScript, Tailwind |
| Core service | Spring Boot 3.2, Java 21 |
| AI service | FastAPI, Python 3.12, Bedrock |
| Data | Aurora PostgreSQL (pgvector), DocumentDB, Redis |
| Infra | CDK, Helm, Docker |
| Auth | Cognito JWT, RBAC |

## Repository structure
```
.
├── frontend/            # React SPA
├── services/            # ai-service, core-service
├── infrastructure/      # cdk, db, localstack
├── helm/                # Helm charts
├── shared/              # Shared TypeScript types
├── docker-compose.yml   # Local dev stack
└── buildspec-*.yml      # CI/CD pipelines
```

## Quick start (local)
### Prerequisites
- Docker Desktop
- Node.js 20+
- Python 3.12+
- Java 21+

### 1) Environment setup
```bash
cp .env.example .env
# Edit .env with your AWS credentials (for Bedrock access)
```

### 2) Start infrastructure
```bash
docker-compose up -d postgres mongo redis localstack
```

### 3) Start AI service
```bash
cd services/ai-service
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 4) Start core service
```bash
cd services/core-service
./mvnw spring-boot:run -Dspring-boot.run.profiles=local
```

### 5) Start frontend
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

## Environment variables
Use .env.example as the template. Key values include AWS credentials for Bedrock, database endpoints, and service URLs.

## Core value loop
1. Create -> User enters content brief with type selection
2. Generate -> Strand agents produce content via Bedrock Converse API (streaming via WebSocket)
3. Edit -> Human refines in TipTap rich text editor (AI vs human text highlighted)
4. Approve -> Editor reviews and approves content
5. Localize -> Amazon Translate + LLM refinement for target locales (parallel async fan-out)
6. Publish -> Push to CMS (Contentful, Strapi, or WordPress) via SQS FIFO

## RBAC roles
| Role | Permissions |
|------|-------------|
| CREATOR | Create, read, edit own content |
| EDITOR | All CREATOR + approve/reject any content |
| PUBLISHER | All EDITOR + push to CMS, access audit log |
| ADMIN | Full access |

## Infrastructure highlights
- VPC: 3 AZs, 3 subnet tiers, VPC endpoints (Bedrock, S3, SQS, Secrets Manager)
- EKS: Graviton3 Spot instances, Karpenter-ready, IRSA per pod
- Aurora PostgreSQL: Serverless v2 (0.5-8 ACU), RDS Proxy, pgvector extension
- DocumentDB: Locale variants with JSON schema validation
- ElastiCache Redis: Embedding cache, session store
- SQS: FIFO queues with DLQs for content-ingest, localize, image-generate, cms-publish
- Cognito: User Pool with MFA, 4 RBAC groups, Identity Pool for S3 uploads
- Bedrock guardrails: Content safety filters + PII anonymization
- WAF: OWASP Core Rule Set + rate limiting (2000 req/IP)
- CloudWatch: Dashboard, DLQ alarms, Aurora CPU alarms
- X-Ray: Distributed tracing across all services

## CI/CD
| Pipeline | Trigger | Steps |
|----------|---------|-------|
| Frontend | Push to main | npm ci -> build -> S3 sync -> CloudFront invalidation |
| AI service | Push to main | lint -> test -> Docker build -> ECR push -> 20-prompt Bedrock eval |
| Core service | Push to main | test -> package -> Docker build -> ECR push |
| Infrastructure | PR to main | iac lint -> validate -> security scan |

### Bedrock eval suite
The AI service CI pipeline includes a 20-prompt evaluation suite that:
- Generates content for 20 diverse prompts using Llama 3.1 8B
- Scores each output using Titan Text Lite as an LLM judge
- Fails the build if the mean score drops below 0.70

## Security
- All secrets in AWS Secrets Manager
- Cognito JWT validation on every API request
- IRSA (IAM Roles for Service Accounts) with least privilege per pod
- WAF with OWASP Core Rule Set + IP-based rate limiting
- Bedrock guardrails for content safety + PII anonymization
- RDS Proxy with IAM auth and TLS required
- S3 buckets: encryption at rest, public access blocked
- ElastiCache: at-rest and in-transit encryption

## Cost optimization
- All AI models on AWS free tier / Bedrock trial
- EKS nodes: Graviton3 Spot instances
- Aurora: Serverless v2 scales to 0.5 ACU when idle
- CloudFront: PriceClass_100 (US/EU only)
- Single NAT Gateway (dev), multi-AZ (prod)
- Embedding cache in Redis reduces Titan Embed V2 API calls

## License
MIT License. See LICENSE.
