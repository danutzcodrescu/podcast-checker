CREATE TABLE "ingestion_lease" (
	"name" text PRIMARY KEY NOT NULL,
	"token" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
