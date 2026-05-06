# GenAI Content Creation Platform — Implementation Plan

## Goal
Build a production-grade GenAI Content Creation Platform for Communications & Media teams using AWS free-tier AI models, with FastAPI + Spring Boot backends, React frontend, and full Terraform infrastructure.

## Build Order (as specified)

### Phase 1: Project Scaffold + Local Dev
- [x] Monorepo structure
- [x] docker-compose.yml + .env.example
- [x] Flyway database migrations

### Phase 2: FastAPI AI Service (Core Value Loop)
- [ ] Project setup (requirements.txt, Dockerfile)
- [ ] Pydantic models for all request/response schemas
- [ ] Bedrock client setup (Converse API)
- [ ] Strand agent for scripting
- [ ] Brand RAG retrieval (pgvector)
- [ ] All endpoints: /generate, /ingest, /localize, /transcribe, /image/generate, /health
- [ ] WebSocket streaming via API Gateway Management API
- [ ] X-Ray instrumentation

### Phase 3: Spring Boot Core Service
- [ ] Project setup (pom.xml, application.yml)
- [ ] Cognito auth + RBAC (CREATOR, EDITOR, PUBLISHER, ADMIN)
- [ ] All REST endpoints (auth, workspaces, content, publish, audit)
- [ ] CMS integrations (Contentful, Strapi, WordPress)
- [ ] Audit log aspect
- [ ] Secrets Manager integration

### Phase 4: React Frontend
- [ ] Vite + React + TypeScript + Tailwind setup
- [ ] Design system + components
- [ ] All pages (dashboard, editor, locales, assets, publish, settings, audit)
- [ ] TipTap editor with streaming AI generation
- [ ] WebSocket hook with auto-reconnect
- [ ] TanStack Query hooks + Zustand stores
- [ ] Diff view (AI vs human edits)

### Phase 5: Terraform Infrastructure
- [ ] All .tf files (VPC, EKS, Aurora, DocumentDB, ElastiCache, S3, Cognito, Bedrock, SQS, ALB, CloudFront, IAM, monitoring)
- [ ] Variable files (dev/prod)

### Phase 6: CDK Event Wiring
- [ ] EventBridge + SQS + Lambda wiring (TypeScript)

### Phase 7: CI/CD
- [ ] Buildspec files (frontend, ai, core, iac)
- [ ] Helm charts per service
- [ ] Pipeline Terraform

### Phase 8: Shared Types + README
- [ ] TypeScript + Pydantic shared models
- [ ] README with 5-command local setup + AWS deploy

## Approved Model List (Free Tier Only)
| Use Case | Model ID |
|---|---|
| Text generation | meta.llama3-1-8b-instruct-v1:0 |
| Text classification | amazon.titan-text-lite-v1 |
| Embeddings | amazon.titan-embed-text-v2:0 |
| Translation | Amazon Translate |
| Transcription | Amazon Transcribe |
| Image generation | amazon.titan-image-generator-v1 |

## Verification Plan
- docker-compose up builds and starts all services
- FastAPI /health returns 200
- FastAPI /generate streams tokens via Bedrock Converse API
- Spring Boot /health returns 200
- React dev server compiles without errors
- Terraform validates successfully
- All buildspec files are valid YAML
