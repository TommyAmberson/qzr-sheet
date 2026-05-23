CREATE TABLE `quiz_disputes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`result_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by_account_id` text,
	`created_by_guest_label` text,
	`reason` text NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`resolved_at` integer,
	`resolved_by_account_id` text,
	FOREIGN KEY (`result_id`) REFERENCES `quiz_results`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resolved_by_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `quiz_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meet_id` integer NOT NULL,
	`quiz_id` integer,
	`room_id` integer,
	`division` text NOT NULL,
	`round` text NOT NULL,
	`submitted_at` integer NOT NULL,
	`submitted_by_account_id` text,
	`submitted_by_guest_label` text,
	`quiz_file` text NOT NULL,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`quiz_id`) REFERENCES `scheduled_quizzes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`room_id`) REFERENCES `meet_rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`submitted_by_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_results_meet_id_quiz_id_unique` ON `quiz_results` (`meet_id`,`quiz_id`);--> statement-breakpoint
CREATE TABLE `quiz_saves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meet_id` integer NOT NULL,
	`scheduled_quiz_id` integer,
	`room_id` integer,
	`division` text NOT NULL,
	`round` text NOT NULL,
	`saved_at` integer NOT NULL,
	`kind` text NOT NULL,
	`label` text,
	`saved_by_account_id` text,
	`saved_by_guest_label` text,
	`quiz_file` text NOT NULL,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scheduled_quiz_id`) REFERENCES `scheduled_quizzes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`room_id`) REFERENCES `meet_rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`saved_by_account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
