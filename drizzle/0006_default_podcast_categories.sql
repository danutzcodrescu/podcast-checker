-- Categories are scoped to an account. Each default has a fixed ID equal to the
-- application's category identity (`categoryId(name)`: trimmed, lower-cased
-- name), so the account/category primary key makes seeding idempotent.
-- The explicit NOT EXISTS check also skips a default when the account already
-- has an equivalent category under a differently-cased or padded name.
INSERT INTO "podcast_category" ("user_id", "id", "name")
SELECT
	"user"."id",
	defaults."id",
	defaults."name"
FROM "user"
CROSS JOIN (
	VALUES
		('sport', 'sport'),
		('story', 'story'),
		('history', 'history'),
		('web', 'web')
) AS defaults ("id", "name")
WHERE NOT EXISTS (
	SELECT 1
	FROM "podcast_category" AS existing
	WHERE existing."user_id" = "user"."id"
		AND (
			existing."id" = defaults."id"
			OR lower(btrim(existing."name")) = defaults."id"
		)
)
ON CONFLICT ("user_id", "id") DO NOTHING;
--> statement-breakpoint
-- Accounts created after this migration receive the same defaults. The trigger
-- only runs on insert, so it cannot add duplicates to an existing account.
CREATE OR REPLACE FUNCTION "seed_default_podcast_categories"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	INSERT INTO "podcast_category" ("user_id", "id", "name")
	SELECT
		NEW."id",
		defaults."id",
		defaults."name"
	FROM (
		VALUES
			('sport', 'sport'),
			('story', 'story'),
			('history', 'history'),
			('web', 'web')
	) AS defaults ("id", "name")
	WHERE NOT EXISTS (
		SELECT 1
		FROM "podcast_category" AS existing
		WHERE existing."user_id" = NEW."id"
			AND (
				existing."id" = defaults."id"
				OR lower(btrim(existing."name")) = defaults."id"
			)
	)
	ON CONFLICT ("user_id", "id") DO NOTHING;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "user_seed_default_podcast_categories" ON "user";
--> statement-breakpoint
CREATE TRIGGER "user_seed_default_podcast_categories"
AFTER INSERT ON "user"
FOR EACH ROW
EXECUTE FUNCTION "seed_default_podcast_categories"();
