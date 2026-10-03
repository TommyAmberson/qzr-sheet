CREATE TABLE `quiz_result_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`result_id` integer NOT NULL,
	`revision` integer NOT NULL,
	`quiz_file` text,
	`restored_from` integer,
	`action` text NOT NULL,
	`saved_by_account_id` text,
	`saved_by_room_id` integer,
	`saved_by_name` text NOT NULL,
	`saved_at` integer NOT NULL,
	FOREIGN KEY (`result_id`) REFERENCES `quiz_results`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`saved_by_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`saved_by_room_id`) REFERENCES `meet_rooms`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "quiz_result_revisions_one_source" CHECK(("quiz_result_revisions"."quiz_file" IS NULL) <> ("quiz_result_revisions"."restored_from" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_result_revisions_result_id_revision_unique` ON `quiz_result_revisions` (`result_id`,`revision`);--> statement-breakpoint
CREATE TABLE `quiz_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meet_id` integer NOT NULL,
	`room_id` integer,
	`quiz_key` text NOT NULL,
	`counted` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `meet_rooms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_results_meet_id_quiz_key_unique` ON `quiz_results` (`meet_id`,`quiz_key`);