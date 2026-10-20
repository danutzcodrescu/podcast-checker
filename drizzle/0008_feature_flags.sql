CREATE TABLE "feature_flag" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
INSERT INTO "feature_flag" ("key", "enabled") VALUES ('signup_enabled', false);
