CREATE TABLE `meet_templates` (
	`meet_id` integer PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`bytes` blob NOT NULL,
	`uploaded_at` integer NOT NULL,
	`uploaded_by_id` text,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
