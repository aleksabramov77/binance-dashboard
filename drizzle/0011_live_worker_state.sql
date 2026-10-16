CREATE TABLE "live_worker_state" (
	"id" text PRIMARY KEY NOT NULL,
	"heartbeat" jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"status_since" timestamp with time zone NOT NULL,
	"silent_since" timestamp with time zone
);
