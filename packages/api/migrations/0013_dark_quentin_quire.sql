CREATE TABLE `quiz_result_scores` (
	`revision_id` integer PRIMARY KEY NOT NULL,
	`shared_version` text NOT NULL,
	`scored` text NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `quiz_result_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
