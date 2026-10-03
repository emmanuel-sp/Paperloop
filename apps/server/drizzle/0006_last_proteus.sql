CREATE TABLE `evaluation_run_cases` (
	`run_id` text NOT NULL,
	`check_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`case_id` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `evaluation_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_check_case_unique` ON `evaluation_run_cases` (`run_id`,`check_id`,`case_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `run_check_case_ordinal_unique` ON `evaluation_run_cases` (`run_id`,`check_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `evaluation_run_checks` (
	`run_id` text NOT NULL,
	`check_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `evaluation_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_check_unique` ON `evaluation_run_checks` (`run_id`,`check_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `run_check_ordinal_unique` ON `evaluation_run_checks` (`run_id`,`ordinal`);
--> statement-breakpoint
PRAGMA user_version = 7;
