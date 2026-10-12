#!/bin/sh

# The image may source this script; keep shell options and helpers isolated.
(
  set -eu

  db_psql() {
    psql -X --set=ON_ERROR_STOP=1 \
      --host=/var/run/postgresql \
      --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" "$@"
  }

  journal=$(cat /drizzle/meta/_journal.json)
  migrations=$(db_psql --tuples-only --no-align --field-separator='|' \
    --set="journal=$journal" <<'SQL'
SELECT entry->>'when', entry->>'tag'
FROM jsonb_array_elements(:'journal'::jsonb->'entries') WITH ORDINALITY AS migrations(entry, position)
ORDER BY position;
SQL
  )

  db_psql <<'SQL'
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
SQL

  while IFS='|' read -r timestamp tag; do
    [ -n "$tag" ] || continue
    migration_file="/drizzle/$tag.sql"
    checksum=$(sha256sum "$migration_file")
    hash=${checksum%% *}

    printf 'Applying migration %s\n' "$tag"
    # Commit the schema changes and Drizzle history entry together.
    db_psql --single-transaction --file="$migration_file" --file=- <<SQL
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES ('$hash', $timestamp);
SQL
  done <<EOF
$migrations
EOF
)
