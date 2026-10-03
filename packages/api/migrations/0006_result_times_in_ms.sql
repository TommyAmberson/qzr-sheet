-- Revisions and counting records keep their times to the millisecond, so a quiz's history orders a
-- save and a count made in the same second. Rows from before this are in seconds; the guard leaves
-- any already in milliseconds alone.
UPDATE `quiz_result_revisions` SET `saved_at` = `saved_at` * 1000 WHERE `saved_at` < 100000000000;--> statement-breakpoint
UPDATE `quiz_result_count_changes` SET `changed_at` = `changed_at` * 1000 WHERE `changed_at` < 100000000000;
