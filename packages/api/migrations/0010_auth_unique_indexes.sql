CREATE UNIQUE INDEX `account_provider_unique` ON `account` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `verification_identifier_unique` ON `verification` (`identifier`);