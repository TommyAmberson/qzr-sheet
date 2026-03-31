ALTER TABLE `quiz_meets` RENAME COLUMN "date" TO "date_from";--> statement-breakpoint
ALTER TABLE `quiz_meets` ADD `date_to` text;