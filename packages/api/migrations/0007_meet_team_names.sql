CREATE TABLE `meet_team_names` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meet_id` integer NOT NULL,
	`division` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meet_team_names_meet_id_division_name_key_unique` ON `meet_team_names` (`meet_id`,`division`,`name_key`);