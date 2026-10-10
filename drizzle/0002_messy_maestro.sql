CREATE TABLE "alert_state" (
	"key" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"last_sent" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"level" text NOT NULL,
	"event" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"error" jsonb,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "app_logs_ts_idx" ON "app_logs" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "app_logs_level_ts_idx" ON "app_logs" USING btree ("level","ts");