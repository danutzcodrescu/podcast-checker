CREATE TABLE "followed_podcast" (
	"user_id" text NOT NULL,
	"podcast_id" bigint NOT NULL,
	"podcast" jsonb NOT NULL,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"followed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "followed_podcast_user_id_podcast_id_pk" PRIMARY KEY("user_id","podcast_id")
);
--> statement-breakpoint
CREATE TABLE "podcast_category" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "podcast_category_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "followed_podcast" ADD CONSTRAINT "followed_podcast_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_category" ADD CONSTRAINT "podcast_category_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
