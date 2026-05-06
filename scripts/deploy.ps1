# =============================================
# GenAI Platform - One-Click AWS Deployment Script
# Run: .\deploy.ps1
# =============================================

param(
    [string]$Region = "us-east-1",
    [switch]$SkipTerraform,
    [switch]$SkipBuild,
    [switch]$SkipFrontend,
    [switch]$Destroy
)

$ErrorActionPreference = "Stop"
# Some AWS CLI checks intentionally rely on exit codes (for example, head-bucket when a bucket does not exist).
# PowerShell 7 can surface native non-zero exits as terminating errors, which breaks this flow.
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$TerraformDir = "$ProjectRoot\infrastructure\terraform-lite"

function Test-AwsCommandSuccess {
    param(
        [scriptblock]$Command
    )

    $previousEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $Command 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $previousEap
    }
}

function Assert-LastExit {
    param(
        [string]$Step
    )

    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERROR: $Step failed (exit code: $LASTEXITCODE)." -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  GenAI Content Platform - AWS Deployment" -ForegroundColor Cyan
Write-Host "  Region: $Region  Stack: Lightweight" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# -- Ensure Terraform is discoverable in this session -----
if (-not (Get-Command terraform -ErrorAction SilentlyContinue)) {
    $wingetLinks = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links"
    if (Test-Path (Join-Path $wingetLinks "terraform.exe")) {
        $env:PATH = "$wingetLinks;$env:PATH"
    }
}

if (-not (Get-Command terraform -ErrorAction SilentlyContinue)) {
    $wingetPackageRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
    if (Test-Path $wingetPackageRoot) {
        $terraformExe = Get-ChildItem $wingetPackageRoot -Directory -Filter "Hashicorp.Terraform*" -ErrorAction SilentlyContinue |
            ForEach-Object { Join-Path $_.FullName "terraform.exe" } |
            Where-Object { Test-Path $_ } |
            Select-Object -First 1

        if ($terraformExe) {
            $env:PATH = "$(Split-Path $terraformExe -Parent);$env:PATH"
        }
    }
}

# -- Verify Prerequisites ---------------------
Write-Host "[1/7] Checking prerequisites..." -ForegroundColor Yellow

$tools = @("aws", "terraform", "docker", "node")
foreach ($tool in $tools) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Write-Host "  ERROR: '$tool' not found. Please install it first." -ForegroundColor Red
        Write-Host "  Install guides:" -ForegroundColor Red
        Write-Host "    aws       -> https://aws.amazon.com/cli/" -ForegroundColor DarkGray
        Write-Host "    terraform -> https://developer.hashicorp.com/terraform/install" -ForegroundColor DarkGray
        Write-Host "    docker    -> https://www.docker.com/products/docker-desktop/" -ForegroundColor DarkGray
        Write-Host "    node      -> https://nodejs.org/" -ForegroundColor DarkGray
        exit 1
    } else {
        Write-Host "  [OK] $tool" -ForegroundColor Green
    }
}

# Verify AWS credentials
$identityJson = aws sts get-caller-identity --output json 2>$null
if (-not $identityJson) {
    Write-Host "  ERROR: AWS not configured. Run 'aws configure' first." -ForegroundColor Red
    exit 1
}
$identity = $identityJson | ConvertFrom-Json
$AccountId = $identity.Account
Write-Host "  [OK] AWS Account: $AccountId" -ForegroundColor Green

# -- Destroy Mode ----------------------------
if ($Destroy) {
    Write-Host ""
    Write-Host "[DESTROY] Tearing down all resources..." -ForegroundColor Red
    Set-Location $TerraformDir
    terraform destroy -auto-approve
    Write-Host "  All resources destroyed." -ForegroundColor Green
    exit 0
}

# -- Step 1: Create Terraform Backend --------
Write-Host ""
Write-Host "[2/7] Setting up Terraform backend..." -ForegroundColor Yellow

$bucketExists = Test-AwsCommandSuccess { aws s3api head-bucket --bucket genai-platform-tfstate }
if (-not $bucketExists) {
    aws s3 mb s3://genai-platform-tfstate --region $Region
    aws s3api put-bucket-versioning --bucket genai-platform-tfstate --versioning-configuration Status=Enabled
    aws dynamodb create-table `
        --table-name genai-platform-tflock `
        --attribute-definitions AttributeName=LockID,AttributeType=S `
        --key-schema AttributeName=LockID,KeyType=HASH `
        --billing-mode PAY_PER_REQUEST `
        --region $Region
    Write-Host "  Backend created." -ForegroundColor Green
} else {
    Write-Host "  Backend already exists." -ForegroundColor Green
}

# -- Step 2: Run Terraform -------------------
if (-not $SkipTerraform) {
    Write-Host ""
    Write-Host "[3/7] Provisioning AWS infrastructure (15-20 min)..." -ForegroundColor Yellow
    Set-Location $TerraformDir

    terraform init -upgrade
    if ($LASTEXITCODE -ne 0) { Write-Host "  Terraform init failed!" -ForegroundColor Red; exit 1 }

    terraform plan -out=tfplan
    if ($LASTEXITCODE -ne 0) { Write-Host "  Terraform plan failed!" -ForegroundColor Red; exit 1 }

    terraform apply -auto-approve tfplan
    if ($LASTEXITCODE -ne 0) { Write-Host "  Terraform apply failed!" -ForegroundColor Red; exit 1 }

    Write-Host "  Infrastructure provisioned!" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[3/7] Skipping Terraform (--SkipTerraform)" -ForegroundColor DarkGray
}

# -- Read Terraform Outputs -------------------
Set-Location $TerraformDir
$outputsJson = terraform output -json
if (-not $outputsJson) {
    Write-Host "  ERROR: Could not read Terraform outputs. Run without -SkipTerraform first." -ForegroundColor Red
    exit 1
}
$outputs = $outputsJson | ConvertFrom-Json

$EcrAi = $outputs.ecr_ai_service_url.value
$EcrCore = $outputs.ecr_core_service_url.value
$AlbDns = $outputs.alb_dns_name.value
$CloudFrontDomain = $outputs.cloudfront_domain.value
$CloudFrontDistId = $outputs.cloudfront_distribution_id.value
$FrontendBucket = $outputs.frontend_bucket.value
$CognitoPoolId = $outputs.cognito_user_pool_id.value
$CognitoClientId = $outputs.cognito_client_id.value

# -- Step 3: Build and Push Docker Images -----
if (-not $SkipBuild) {
    Write-Host ""
    Write-Host "[4/7] Building and pushing Docker images..." -ForegroundColor Yellow

    # Ensure Docker daemon is available before attempting login/build/push.
    docker info >$null 2>$null
    Assert-LastExit "Docker daemon check"

    # ECR Login
    $ecrPass = aws ecr get-login-password --region $Region
    Assert-LastExit "Get ECR login password"
    # PowerShell -> native stdin can corrupt token encoding on Windows, causing ECR 400 errors.
    # Use explicit password arg here for reliability in this environment.
    docker login --username AWS --password "$ecrPass" "$AccountId.dkr.ecr.$Region.amazonaws.com"
    Assert-LastExit "ECR docker login"

    # AI Service
    Write-Host "  Building AI Service..." -ForegroundColor Cyan
    Set-Location "$ProjectRoot\services\ai-service"
    docker build -t genai-ai-service .
    Assert-LastExit "AI service docker build"
    docker tag genai-ai-service:latest "${EcrAi}:latest"
    Assert-LastExit "AI service docker tag"
    docker push "${EcrAi}:latest"
    Assert-LastExit "AI service docker push"

    # Core Service
    Write-Host "  Building Core Service..." -ForegroundColor Cyan
    Set-Location "$ProjectRoot\services\core-service"
    docker build -t genai-core-service .
    Assert-LastExit "Core service docker build"
    docker tag genai-core-service:latest "${EcrCore}:latest"
    Assert-LastExit "Core service docker tag"
    docker push "${EcrCore}:latest"
    Assert-LastExit "Core service docker push"

    Write-Host "  Images pushed to ECR!" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[4/7] Skipping Docker build (--SkipBuild)" -ForegroundColor DarkGray
}

# -- Step 4: Force ECS Service Update --------
Write-Host ""
Write-Host "[5/7] Deploying to ECS Fargate..." -ForegroundColor Yellow

$null = aws ecs update-service --cluster genai-platform-cluster --service genai-platform-ai --force-new-deployment --region $Region
$null = aws ecs update-service --cluster genai-platform-cluster --service genai-platform-core --force-new-deployment --region $Region
Assert-LastExit "ECS force-new-deployment"

Write-Host "  Waiting for ECS services to become stable..." -ForegroundColor DarkGray
aws ecs wait services-stable --cluster genai-platform-cluster --services genai-platform-ai genai-platform-core --region $Region
Assert-LastExit "ECS services-stable wait"

Write-Host "  ECS services are stable with the latest deployment." -ForegroundColor Green

# -- Step 5: Deploy Frontend -----------------
if (-not $SkipFrontend) {
    Write-Host ""
    Write-Host "[6/7] Building and deploying frontend..." -ForegroundColor Yellow

    Set-Location "$ProjectRoot\frontend"

    # Create production .env with ALB endpoint
    $envContent = @"
VITE_API_BASE=/api
VITE_AI_BASE=
VITE_WS_URL=wss://$CloudFrontDomain/ws
VITE_COGNITO_POOL_ID=$CognitoPoolId
VITE_COGNITO_CLIENT_ID=$CognitoClientId
VITE_COGNITO_REGION=$Region
"@
    $envContent | Set-Content -Path ".env.production" -Encoding UTF8

    npm install
    Assert-LastExit "Frontend npm install"
    npm run build
    Assert-LastExit "Frontend npm run build"

    # Sync hashed assets with long immutable cache; index.html is uploaded separately with no-store.
    aws s3 sync dist/ "s3://$FrontendBucket/" --delete --region $Region --exclude "index.html" --cache-control "public,max-age=31536000,immutable"
    Assert-LastExit "Frontend asset sync"

    # Upload HTML shell with no-cache to prevent stale bundle references after deploy.
    aws s3 cp "dist/index.html" "s3://$FrontendBucket/index.html" --region $Region --cache-control "no-cache,no-store,must-revalidate" --content-type "text/html; charset=utf-8"
    Assert-LastExit "Frontend index upload"

    # Invalidate CloudFront cache
    $invalidationJson = aws cloudfront create-invalidation --distribution-id $CloudFrontDistId --paths "/*" --output json
    Assert-LastExit "CloudFront invalidation create"
    $invalidation = $invalidationJson | ConvertFrom-Json
    aws cloudfront wait invalidation-completed --distribution-id $CloudFrontDistId --id $invalidation.Invalidation.Id
    Assert-LastExit "CloudFront invalidation wait"

    Write-Host "  Frontend deployed to CloudFront!" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[6/7] Skipping frontend (--SkipFrontend)" -ForegroundColor DarkGray
}

# -- Step 6: Create Admin User ---------------
Write-Host ""
Write-Host "[7/7] Creating admin user in Cognito..." -ForegroundColor Yellow

$adminUserExists = Test-AwsCommandSuccess {
    aws cognito-idp admin-get-user --user-pool-id $CognitoPoolId --username admin@genai-platform.com --region $Region
}
if (-not $adminUserExists) {
    $null = aws cognito-idp admin-create-user `
        --user-pool-id $CognitoPoolId `
        --username admin@genai-platform.com `
        --user-attributes Name=email,Value=admin@genai-platform.com Name=email_verified,Value=true `
        --temporary-password "TempPass123!" `
        --region $Region

    $null = aws cognito-idp admin-add-user-to-group `
        --user-pool-id $CognitoPoolId `
        --username admin@genai-platform.com `
        --group-name ADMIN `
        --region $Region

    Write-Host "  Admin user created: admin@genai-platform.com / TempPass123!" -ForegroundColor Green
} else {
    Write-Host "  Admin user already exists." -ForegroundColor Green
}

# -- Summary ----------------------------------
Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Frontend:    https://$CloudFrontDomain" -ForegroundColor White
Write-Host "  API (Core):  http://$AlbDns/api/content" -ForegroundColor White
Write-Host "  API (AI):    http://$AlbDns/health" -ForegroundColor White
Write-Host ""
Write-Host "  Admin Login: admin@genai-platform.com" -ForegroundColor Yellow
Write-Host "  Temp Pass:   TempPass123!" -ForegroundColor Yellow
Write-Host ""
Write-Host "  To destroy:  .\deploy.ps1 -Destroy" -ForegroundColor DarkGray
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""
