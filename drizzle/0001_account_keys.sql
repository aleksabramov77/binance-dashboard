CREATE TABLE `account_keys` (
	`name` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`tag` text NOT NULL,
	`key_hint` text NOT NULL,
	`restrictions` text NOT NULL,
	`saved_at` integer NOT NULL
);
