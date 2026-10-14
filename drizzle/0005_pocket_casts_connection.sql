CREATE TABLE "pocket_casts_connection" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"encrypted_tokens" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pocket_casts_connection" ADD CONSTRAINT "pocket_casts_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;