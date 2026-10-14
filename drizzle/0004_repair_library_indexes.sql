-- Custom SQL migration file, put your code below! --
-- The move from postgres:18-alpine (musl) to pgvector/pgvector:pg18
-- (glibc) reused the data volume, but changed text collation ordering.
-- Old indexes can miss existing keys, even for INSERT ... ON CONFLICT.
-- Do not use those indexes while identifying duplicate category rows.
SET LOCAL enable_indexscan = off;
SET LOCAL enable_indexonlyscan = off;
SET LOCAL enable_bitmapscan = off;
--> statement-breakpoint
LOCK TABLE "podcast_category" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
-- Keep the original row for each exact account/category identity. Podcast
-- assignments reference these IDs, so no assignment needs to be removed.
WITH duplicates AS (
  SELECT ctid,
    row_number() OVER (
      PARTITION BY "user_id" COLLATE "C", "id" COLLATE "C" ORDER BY ctid
    ) AS position
  FROM "podcast_category"
)
DELETE FROM "podcast_category"
WHERE ctid IN (SELECT ctid FROM duplicates WHERE position > 1);
--> statement-breakpoint
-- Rebuild all application-table indexes: the image change also affected text
-- keys in authentication and following tables, not only categories. Individual
-- REINDEX TABLE commands keep the repair in the migration's transaction.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = current_schema()
    ORDER BY tablename
  LOOP
    EXECUTE format('REINDEX TABLE %I.%I', target.schemaname, target.tablename);
  END LOOP;
END $$;
