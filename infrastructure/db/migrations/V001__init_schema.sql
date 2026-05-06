-- ═══════════════════════════════════════════════════════════════
-- V001 — GenAI Content Platform Initial Schema
-- Aurora PostgreSQL Serverless v2 + pgvector
-- ═══════════════════════════════════════════════════════════════

-- Enable pgvector extension for embedding storage
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Workspaces ─────────────────────────────────────────────────
CREATE TABLE workspaces (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    brand_kb_id TEXT,                     -- Bedrock Knowledge Base ID
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE workspaces IS 'Top-level workspace, one per brand/team';
COMMENT ON COLUMN workspaces.brand_kb_id IS 'Amazon Bedrock Knowledge Base ID for brand voice RAG';

-- ── Users ──────────────────────────────────────────────────────
CREATE TABLE users (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cognito_sub    TEXT UNIQUE NOT NULL,
    email          TEXT UNIQUE NOT NULL,
    display_name   TEXT NOT NULL,
    role           TEXT NOT NULL DEFAULT 'CREATOR'
                   CHECK (role IN ('CREATOR', 'EDITOR', 'PUBLISHER', 'ADMIN')),
    workspace_id   UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_workspace ON users(workspace_id);
CREATE INDEX idx_users_cognito_sub ON users(cognito_sub);

-- ── Content Pieces ─────────────────────────────────────────────
CREATE TABLE content_pieces (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    brief         TEXT NOT NULL,
    content_type  TEXT NOT NULL CHECK (content_type IN (
                      'article', 'script', 'social', 'email', 'ad'
                  )),
    status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                      'draft', 'generating', 'review', 'approved',
                      'localizing', 'localized', 'publishing', 'published'
                  )),
    target_locales TEXT DEFAULT '',
    created_by    UUID NOT NULL REFERENCES users(id),
    updated_by    UUID REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_content_workspace ON content_pieces(workspace_id);
CREATE INDEX idx_content_status ON content_pieces(status);
CREATE INDEX idx_content_created_by ON content_pieces(created_by);
CREATE INDEX idx_content_type ON content_pieces(content_type);

-- ── Content Versions ───────────────────────────────────────────
CREATE TABLE content_versions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    piece_id     UUID NOT NULL REFERENCES content_pieces(id) ON DELETE CASCADE,
    version_num  INTEGER NOT NULL,
    body         TEXT NOT NULL,
    model_used   TEXT NOT NULL,           -- always log which model generated
    prompt_hash  TEXT NOT NULL,
    tokens_used  INTEGER,
    latency_ms   INTEGER,                 -- generation latency tracking
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(piece_id, version_num)
);

CREATE INDEX idx_versions_piece ON content_versions(piece_id);

-- ── Brand Embeddings (RAG Vector Store) ────────────────────────
CREATE TABLE brand_embeddings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    chunk_text    TEXT NOT NULL,
    embedding     vector(1024),           -- Titan Embed V2 dimension
    source_doc    TEXT,
    chunk_index   INTEGER DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- IVFFlat index for cosine similarity search
CREATE INDEX idx_brand_embeddings_vector
    ON brand_embeddings USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE INDEX idx_brand_embeddings_workspace
    ON brand_embeddings(workspace_id);

-- ── Audit Log (Append-Only) ────────────────────────────────────
CREATE TABLE audit_log (
    id         BIGSERIAL PRIMARY KEY,
    piece_id   UUID,
    action     TEXT NOT NULL,
    actor_id   UUID NOT NULL,
    model_used TEXT,
    metadata   JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_piece ON audit_log(piece_id);
CREATE INDEX idx_audit_actor ON audit_log(actor_id);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_created ON audit_log(created_at);

-- Append-only enforcement: create restricted role
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user LOGIN PASSWORD 'app_password';
    END IF;
END
$$;

GRANT SELECT, INSERT ON audit_log TO app_user;
-- REVOKE UPDATE, DELETE enforces append-only on audit_log
REVOKE UPDATE, DELETE ON audit_log FROM app_user;

-- ── Helper function: auto-update updated_at ────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_workspaces_updated_at
    BEFORE UPDATE ON workspaces
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_content_pieces_updated_at
    BEFORE UPDATE ON content_pieces
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
