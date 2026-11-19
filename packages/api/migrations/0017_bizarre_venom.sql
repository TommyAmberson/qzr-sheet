CREATE TABLE `meet_name_dismissals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meet_id` integer NOT NULL,
	`division` text NOT NULL,
	`team` text NOT NULL,
	`name_a` text NOT NULL,
	`name_b` text NOT NULL,
	`by_account_id` text,
	`by_name` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`by_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meet_name_dismissals_unique` ON `meet_name_dismissals` (`meet_id`,`division`,`team`,`name_a`,`name_b`);