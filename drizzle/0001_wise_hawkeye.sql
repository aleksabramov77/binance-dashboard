CREATE TABLE "earn_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"offers" jsonb NOT NULL,
	CONSTRAINT "earn_snapshots_fetched_at_unique" UNIQUE("fetched_at")
);
