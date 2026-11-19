CREATE TABLE `meet_stats_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meet_id` integer NOT NULL,
	`settings` text NOT NULL,
	`saved_by_account_id` text,
	`saved_by_name` text NOT NULL,
	`saved_at` integer NOT NULL,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`saved_by_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `meet_stats_settings_meet_id_idx` ON `meet_stats_settings` (`meet_id`);