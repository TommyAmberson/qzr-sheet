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
CREATE TABLE `admin_memberships` (
	`account_id` text NOT NULL,
	`meet_id` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_memberships_account_id_meet_id_unique` ON `admin_memberships` (`account_id`,`meet_id`);--> statement-breakpoint
CREATE TABLE `churches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meet_id` integer NOT NULL,
	`name` text NOT NULL,
	`short_name` text NOT NULL,
	`coach_code_hash` text NOT NULL,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `coach_memberships` (
	`account_id` text NOT NULL,
	`church_id` integer NOT NULL,
	`meet_id` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`church_id`) REFERENCES `churches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coach_memberships_account_id_church_id_unique` ON `coach_memberships` (`account_id`,`church_id`);--> statement-breakpoint
CREATE TABLE `official_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meet_id` integer NOT NULL,
	`label` text NOT NULL,
	`code_hash` text NOT NULL,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `official_memberships` (
	`account_id` text NOT NULL,
	`meet_id` integer NOT NULL,
	`official_code_id` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`official_code_id`) REFERENCES `official_codes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `official_memberships_account_id_meet_id_official_code_id_unique` ON `official_memberships` (`account_id`,`meet_id`,`official_code_id`);--> statement-breakpoint
CREATE TABLE `quiz_meets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`date_from` text NOT NULL,
	`date_to` text,
	`admin_code_hash` text NOT NULL,
	`viewer_code` text NOT NULL,
	`divisions` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quizzer_identities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL
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
CREATE TABLE `team_rosters` (
	`team_id` integer NOT NULL,
	`quizzer_id` integer NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`quizzer_id`) REFERENCES `quizzer_identities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_rosters_team_id_quizzer_id_unique` ON `team_rosters` (`team_id`,`quizzer_id`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meet_id` integer NOT NULL,
	`church_id` integer NOT NULL,
	`division` text NOT NULL,
	`number` integer NOT NULL,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`church_id`) REFERENCES `churches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
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
CREATE TABLE `viewer_memberships` (
	`account_id` text NOT NULL,
	`meet_id` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `viewer_memberships_account_id_meet_id_unique` ON `viewer_memberships` (`account_id`,`meet_id`);