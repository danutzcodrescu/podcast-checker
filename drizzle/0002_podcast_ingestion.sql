CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "episode_embedding" (
	"episode_id" uuid PRIMARY KEY NOT NULL,
	"input" text NOT NULL,
	"content_hash" text NOT NULL,
	"model" text NOT NULL,
	"preprocessing_version" integer NOT NULL,
	"embedding" vector(1536),
	"status" text DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"embedded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "podcast_episode" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed_id" uuid NOT NULL,
	"key" text NOT NULL,
	"guid" text,
	"title" text NOT NULL,
	"embedding_title" text NOT NULL,
	"description" text NOT NULL,
	"description_html" text,
	"cleaned_description" text NOT NULL,
	"published_at" timestamp with time zone,
	"duration_seconds" integer,
	"episode_number" text,
	"season_number" text,
	"episode_type" text,
	"explicit" boolean,
	"audio_url" text,
	"artwork_url" text,
	"link" text,
	"metadata" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "podcast_feed" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"resolved_url" text,
	"title" text,
	"description" text,
	"language" text,
	"publisher" text,
	"metadata" jsonb,
	"etag" text,
	"last_modified" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"last_error" text,
	"last_synced_at" timestamp with time zone,
	"next_sync_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "podcast_feed_url_unique" UNIQUE("url")
);
--> statement-breakpoint
ALTER TABLE "followed_podcast" ADD COLUMN "feed_id" uuid;--> statement-breakpoint
ALTER TABLE "episode_embedding" ADD CONSTRAINT "episode_embedding_episode_id_podcast_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."podcast_episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_episode" ADD CONSTRAINT "podcast_episode_feed_id_podcast_feed_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."podcast_feed"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_embedding_pending_idx" ON "episode_embedding" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "podcast_episode_feed_key_idx" ON "podcast_episode" USING btree ("feed_id","key");--> statement-breakpoint
CREATE INDEX "podcast_feed_due_idx" ON "podcast_feed" USING btree ("next_sync_at");--> statement-breakpoint
ALTER TABLE "followed_podcast" ADD CONSTRAINT "followed_podcast_feed_id_podcast_feed_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."podcast_feed"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "followed_podcast_feed_idx" ON "followed_podcast" USING btree ("feed_id");
--> statement-breakpoint
INSERT INTO "podcast_feed" ("url")
SELECT DISTINCT regexp_replace("podcast"->>'feedUrl', '#.*$', '')
FROM "followed_podcast"
WHERE "podcast"->>'feedUrl' ~ '^https?://'
ON CONFLICT ("url") DO NOTHING;
--> statement-breakpoint
UPDATE "followed_podcast" AS followed
SET "feed_id" = feed."id"
FROM "podcast_feed" AS feed
WHERE feed."url" = regexp_replace(followed."podcast"->>'feedUrl', '#.*$', '');
