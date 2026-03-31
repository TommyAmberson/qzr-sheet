CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`id_token` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`role` text DEFAULT 'normal' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
DROP TABLE `oauth_accounts`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_churches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meet_id` integer NOT NULL,
	`created_by` text NOT NULL,
	`name` text NOT NULL,
	`short_name` text NOT NULL,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_churches`("id", "meet_id", "created_by", "name", "short_name") SELECT "id", "meet_id", "created_by", "name", "short_name" FROM `churches`;--> statement-breakpoint
DROP TABLE `churches`;--> statement-breakpoint
ALTER TABLE `__new_churches` RENAME TO `churches`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_coach_memberships` (
	`account_id` text NOT NULL,
	`meet_id` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_coach_memberships`("account_id", "meet_id") SELECT "account_id", "meet_id" FROM `coach_memberships`;--> statement-breakpoint
DROP TABLE `coach_memberships`;--> statement-breakpoint
ALTER TABLE `__new_coach_memberships` RENAME TO `coach_memberships`;--> statement-breakpoint
CREATE UNIQUE INDEX `coach_memberships_account_id_meet_id_unique` ON `coach_memberships` (`account_id`,`meet_id`);--> statement-breakpoint
CREATE TABLE `__new_official_memberships` (
	`account_id` text NOT NULL,
	`meet_id` integer NOT NULL,
	`official_code_id` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`official_code_id`) REFERENCES `official_codes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_official_memberships`("account_id", "meet_id", "official_code_id") SELECT "account_id", "meet_id", "official_code_id" FROM `official_memberships`;--> statement-breakpoint
DROP TABLE `official_memberships`;--> statement-breakpoint
ALTER TABLE `__new_official_memberships` RENAME TO `official_memberships`;--> statement-breakpoint
CREATE UNIQUE INDEX `official_memberships_account_id_meet_id_official_code_id_unique` ON `official_memberships` (`account_id`,`meet_id`,`official_code_id`);--> statement-breakpoint
CREATE TABLE `__new_viewer_memberships` (
	`account_id` text NOT NULL,
	`meet_id` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_viewer_memberships`("account_id", "meet_id") SELECT "account_id", "meet_id" FROM `viewer_memberships`;--> statement-breakpoint
DROP TABLE `viewer_memberships`;--> statement-breakpoint
ALTER TABLE `__new_viewer_memberships` RENAME TO `viewer_memberships`;--> statement-breakpoint
CREATE UNIQUE INDEX `viewer_memberships_account_id_meet_id_unique` ON `viewer_memberships` (`account_id`,`meet_id`);