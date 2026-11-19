CREATE TABLE `division_confirmations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meet_id` integer NOT NULL,
	`division` text NOT NULL,
	`what` text NOT NULL,
	`confirmed` integer NOT NULL,
	`teams` text,
	`affected` text,
	`by_account_id` text,
	`by_name` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`by_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `division_confirmations_meet_id_idx` ON `division_confirmations` (`meet_id`);