ALTER TABLE `official_codes` RENAME TO `meet_rooms`;--> statement-breakpoint
ALTER TABLE `meet_rooms` RENAME COLUMN "label" TO "name";--> statement-breakpoint
CREATE TABLE `division_states` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meet_id` integer NOT NULL,
	`division` text NOT NULL,
	`state` text DEFAULT 'prelim_running' NOT NULL,
	`transitioned_at` integer NOT NULL,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `division_states_meet_id_division_unique` ON `division_states` (`meet_id`,`division`);--> statement-breakpoint
CREATE TABLE `meet_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meet_id` integer NOT NULL,
	`start_at` integer NOT NULL,
	`duration_minutes` integer NOT NULL,
	`kind` text NOT NULL,
	`event_label` text,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `prelim_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meet_id` integer NOT NULL,
	`division` text NOT NULL,
	`letter` text NOT NULL,
	`team_id` integer NOT NULL,
	`assigned_at` integer NOT NULL,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prelim_assignments_meet_id_division_letter_unique` ON `prelim_assignments` (`meet_id`,`division`,`letter`);--> statement-breakpoint
CREATE TABLE `scheduled_quiz_seats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quiz_id` integer NOT NULL,
	`seat_number` integer NOT NULL,
	`letter` text,
	`seed_ref` text,
	FOREIGN KEY (`quiz_id`) REFERENCES `scheduled_quizzes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scheduled_quizzes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meet_id` integer NOT NULL,
	`slot_id` integer NOT NULL,
	`room_id` integer NOT NULL,
	`division` text NOT NULL,
	`phase` text NOT NULL,
	`lane` text,
	`label` text NOT NULL,
	`bracket_label` text,
	`published_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slot_id`) REFERENCES `meet_slots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `meet_rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `seed_resolutions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meet_id` integer NOT NULL,
	`seed_ref` text NOT NULL,
	`team_id` integer NOT NULL,
	`resolved_at` integer NOT NULL,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seed_resolutions_meet_id_seed_ref_unique` ON `seed_resolutions` (`meet_id`,`seed_ref`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_meet_rooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meet_id` integer NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`code_hash` text,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_meet_rooms`("id", "meet_id", "name", "sort_order", "code_hash") SELECT "id", "meet_id", "name", "sort_order", "code_hash" FROM `meet_rooms`;--> statement-breakpoint
DROP TABLE `meet_rooms`;--> statement-breakpoint
ALTER TABLE `__new_meet_rooms` RENAME TO `meet_rooms`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `official_memberships` RENAME COLUMN "official_code_id" TO "room_id";--> statement-breakpoint
CREATE TABLE `__new_official_memberships` (
	`account_id` text NOT NULL,
	`meet_id` integer NOT NULL,
	`room_id` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meet_id`) REFERENCES `quiz_meets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `meet_rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_official_memberships`("account_id", "meet_id", "room_id") SELECT "account_id", "meet_id", "room_id" FROM `official_memberships`;--> statement-breakpoint
DROP TABLE `official_memberships`;--> statement-breakpoint
ALTER TABLE `__new_official_memberships` RENAME TO `official_memberships`;--> statement-breakpoint
CREATE UNIQUE INDEX `official_memberships_account_id_meet_id_room_id_unique` ON `official_memberships` (`account_id`,`meet_id`,`room_id`);--> statement-breakpoint
ALTER TABLE `quiz_meets` ADD `phase` text DEFAULT 'registration' NOT NULL;--> statement-breakpoint
ALTER TABLE `quiz_meets` ADD `registration_closes_at` integer;--> statement-breakpoint
ALTER TABLE `quiz_meets` ADD `meet_starts_at` integer;