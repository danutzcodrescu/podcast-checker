CREATE TABLE "episode_search_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"episode_ids" uuid[] NOT NULL,
	"text_match_ids" uuid[] NOT NULL,
	"semantic_unavailable" boolean NOT NULL,
	"ranking" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episode_search_session" ADD CONSTRAINT "episode_search_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_search_session_expiry_idx" ON "episode_search_session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "episode_search_session_lookup_idx" ON "episode_search_session" USING btree ("user_id","fingerprint","expires_at");