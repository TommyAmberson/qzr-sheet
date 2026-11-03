CREATE TABLE `meet_schedule_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meet_id` integer NOT NULL,
	`version` integer NOT NULL,
	`document` text NOT NULL,
	`published_at` integer NOT NULL,
	`published_by_account_id` text,
	`published_by_name` text NOT NULL,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`published_by_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meet_schedule_versions_meet_id_version_unique` ON `meet_schedule_versions` (`meet_id`,`version`);--> statement-breakpoint
CREATE TABLE `meet_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meet_id` integer NOT NULL,
	`draft` text NOT NULL,
	`draft_revision` integer NOT NULL,
	`draft_saved_at` integer NOT NULL,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meet_schedules_meet_id_unique` ON `meet_schedules` (`meet_id`);