// ═══════════════════════════════════════════════════════════════
// MongoDB / DocumentDB — Locale Variants Collection Init
// ═══════════════════════════════════════════════════════════════

db = db.getSiblingDB("genai_locales");

// ── Locale Variants Collection ────────────────────────────────
db.createCollection("locale_variants", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["master_id", "locale", "translated_body", "status", "created_at"],
      properties: {
        master_id: {
          bsonType: "string",
          description: "UUID linking to content_pieces.id in PostgreSQL"
        },
        locale: {
          bsonType: "string",
          description: "BCP 47 locale code (e.g., fr-FR, es-ES, ja-JP)"
        },
        translated_body: {
          bsonType: "string",
          description: "Translated content body"
        },
        subtitle_srt: {
          bsonType: ["string", "null"],
          description: "SRT subtitle content if audio was transcribed"
        },
        subtitle_vtt: {
          bsonType: ["string", "null"],
          description: "WebVTT subtitle content if audio was transcribed"
        },
        image_urls: {
          bsonType: "array",
          items: { bsonType: "string" },
          description: "S3 URLs for locale-specific image assets"
        },
        status: {
          enum: ["pending", "approved", "published"],
          description: "Locale variant approval status"
        },
        approved_by: {
          bsonType: ["string", "null"],
          description: "UUID of the user who approved"
        },
        published_at: {
          bsonType: ["date", "null"],
          description: "Timestamp when published to CMS"
        },
        translate_job_id: {
          bsonType: ["string", "null"],
          description: "Amazon Translate job ID for tracking"
        },
        source_language: {
          bsonType: "string",
          description: "Source language code"
        },
        model_used: {
          bsonType: ["string", "null"],
          description: "Model used for refinement pass"
        },
        created_at: {
          bsonType: "date"
        },
        updated_at: {
          bsonType: "date"
        }
      }
    }
  }
});

// ── Indexes ───────────────────────────────────────────────────
db.locale_variants.createIndex({ master_id: 1 });
db.locale_variants.createIndex({ locale: 1 });
db.locale_variants.createIndex({ master_id: 1, locale: 1 }, { unique: true });
db.locale_variants.createIndex({ status: 1 });
db.locale_variants.createIndex({ created_at: -1 });

print("✅ genai_locales.locale_variants collection initialized with schema validation and indexes");
