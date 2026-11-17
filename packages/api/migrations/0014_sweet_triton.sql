CREATE TABLE `quiz_result_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`result_id` integer NOT NULL,
	`kind` text NOT NULL,
	`stage` text,
	`schedule_quiz_id` text,
	`how` text,
	`revision` integer,
	`accepted` integer,
	`changed_by_account_id` text,
	`changed_by_room_id` integer,
	`changed_by_name` text NOT NULL,
	`changed_at` integer NOT NULL,
	FOREIGN KEY (`result_id`) REFERENCES `quiz_results`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changed_by_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`changed_by_room_id`) REFERENCES `meet_rooms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `quiz_result_changes_result_id_idx` ON `quiz_result_changes` (`result_id`);