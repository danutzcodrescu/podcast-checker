-- Embeddings from different models are not comparable. Preserve each episode's
-- input, but invalidate old vectors during this explicit provider migration.
ALTER TABLE "episode_embedding" ALTER COLUMN "embedding" SET DATA TYPE vector(1024)
  USING NULL::vector(1024);
--> statement-breakpoint
UPDATE "episode_embedding"
SET "model" = '@cf/qwen/qwen3-embedding-0.6b',
    "preprocessing_version" = 1,
    "content_hash" = encode(sha256(convert_to('@cf/qwen/qwen3-embedding-0.6b:1:' || "input", 'UTF8')), 'hex'),
    "status" = 'pending',
    "last_error" = NULL,
    "embedded_at" = NULL,
    "next_attempt_at" = now();
