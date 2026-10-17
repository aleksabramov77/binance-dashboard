CREATE TABLE `earn_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fetched_at` integer NOT NULL,
	`offers` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `earn_snapshots_fetched_at_unique` ON `earn_snapshots` (`fetched_at`);--> statement-breakpoint
CREATE TABLE `demo_mirror_orders` (
	`trade_id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`direction` text NOT NULL,
	`status` text NOT NULL,
	`demo_ref` text,
	`entry_price` real,
	`quantity` real,
	`exit_price` real,
	`message` text DEFAULT '' NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`protect_refs` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`closed_at` integer,
	FOREIGN KEY (`trade_id`) REFERENCES `paper_trades`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `demo_mirror_orders_status_idx` ON `demo_mirror_orders` (`status`);--> statement-breakpoint
CREATE TABLE `engine_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`market` text NOT NULL,
	`name` text NOT NULL,
	`hypothesis` text NOT NULL,
	`config` text NOT NULL,
	`initial_budget` real NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`demo_mirror` integer DEFAULT false NOT NULL,
	`demo_mirror_mode` text DEFAULT 'auto' NOT NULL,
	`demo_mirror_since` integer,
	`demo_mirror_advice` text,
	`demo_mirror_auto` text,
	`reset_at` integer,
	`live_mirror` integer DEFAULT false NOT NULL,
	`live_mirror_since` integer,
	`live_mirror_by` text,
	`live_mirror_mode` text DEFAULT 'off' NOT NULL,
	`live_loss_limit_usd` real DEFAULT 15 NOT NULL,
	`live_loss_streak` integer DEFAULT 5 NOT NULL,
	`live_auto_off_at` integer,
	`live_auto_off_reason` text,
	`live_mirror_advice` text,
	`live_mirror_auto` text,
	`demo_reset_at` integer,
	`parent_id` text,
	`variant_note` text,
	`disabled_reason` text,
	`disabled_note` text,
	`disabled_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `live_mirror_orders` (
	`trade_id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`direction` text NOT NULL,
	`status` text NOT NULL,
	`live_ref` text,
	`entry_price` real,
	`quantity` real,
	`notional_usd` real,
	`stop_loss` real,
	`exit_price` real,
	`fees_usd` real,
	`realized_pnl` real,
	`pnl_estimated` integer DEFAULT false NOT NULL,
	`closed_by` text,
	`no_protection` integer DEFAULT false NOT NULL,
	`close_attempts` integer DEFAULT 0 NOT NULL,
	`leftover_qty` real,
	`leftover_usd` real,
	`message` text DEFAULT '' NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`protect_refs` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`closed_at` integer,
	FOREIGN KEY (`trade_id`) REFERENCES `paper_trades`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `live_mirror_orders_status_idx` ON `live_mirror_orders` (`status`);--> statement-breakpoint
CREATE INDEX `live_mirror_orders_experiment_closed_idx` ON `live_mirror_orders` (`experiment_id`,`closed_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `live_mirror_orders_active_coin_uq` ON `live_mirror_orders` (`market`,`symbol`) WHERE "live_mirror_orders"."status" in ('pending', 'protected', 'unprotected', 'closing', 'close_failed');--> statement-breakpoint
CREATE TABLE `paper_trades` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` integer NOT NULL,
	`experiment_id` text NOT NULL,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`direction` text NOT NULL,
	`opened_at` integer NOT NULL,
	`entry_price` real NOT NULL,
	`quantity` real NOT NULL,
	`initial_stop` real,
	`stop` real,
	`take_profit` real,
	`atr` real NOT NULL,
	`extreme` real NOT NULL,
	`checked_until` integer NOT NULL,
	`closed_at` integer,
	`exit_price` real,
	`exit_reason` text,
	`fees` real DEFAULT 0 NOT NULL,
	`pnl` real,
	`r_multiple` real,
	`demo_order_ref` text,
	`signal` text DEFAULT '{}' NOT NULL,
	`mae` real,
	`entry_context` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `paper_trades_run_experiment_idx` ON `paper_trades` (`run_id`,`experiment_id`);--> statement-breakpoint
CREATE INDEX `paper_trades_run_closed_idx` ON `paper_trades` (`run_id`,`closed_at`);--> statement-breakpoint
CREATE INDEX `paper_trades_symbol_idx` ON `paper_trades` (`symbol`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `skipped_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` integer NOT NULL,
	`experiment_id` text NOT NULL,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`direction` text NOT NULL,
	`bar` integer NOT NULL,
	`at` integer NOT NULL,
	`reason` text NOT NULL,
	`entry_price` real NOT NULL,
	`stop` real,
	`take_profit` real,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `skipped_signals_run_experiment_idx` ON `skipped_signals` (`run_id`,`experiment_id`);--> statement-breakpoint
CREATE INDEX `skipped_signals_at_idx` ON `skipped_signals` (`at`);--> statement-breakpoint
CREATE TABLE `live_trading_halt` (
	`id` text PRIMARY KEY NOT NULL,
	`stopped` integer DEFAULT false NOT NULL,
	`stopped_at` integer,
	`stopped_by` text,
	`close_all_requested_at` integer,
	`close_all_requested_by` text,
	`close_all_done_at` integer,
	`close_all_result` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `live_worker_state` (
	`id` text PRIMARY KEY NOT NULL,
	`heartbeat` text NOT NULL,
	`received_at` integer NOT NULL,
	`status` text NOT NULL,
	`status_since` integer NOT NULL,
	`silent_since` integer
);
--> statement-breakpoint
CREATE TABLE `alert_state` (
	`key` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`last_sent` integer
);
--> statement-breakpoint
CREATE TABLE `app_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`level` text NOT NULL,
	`event` text NOT NULL,
	`message` text NOT NULL,
	`data` text,
	`error` text,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `app_logs_ts_idx` ON `app_logs` (`ts`);--> statement-breakpoint
CREATE INDEX `app_logs_level_ts_idx` ON `app_logs` (`level`,`ts`);