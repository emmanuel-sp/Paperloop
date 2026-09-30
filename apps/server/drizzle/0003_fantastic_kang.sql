CREATE TABLE `evaluation_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`configuration` text NOT NULL,
	`fingerprint` text NOT NULL,
	`approved_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evaluation_plan_version_unique` ON `evaluation_plans` (`project_id`,`version`);--> statement-breakpoint
CREATE TABLE `evaluation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `experiment_comparisons` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `experiment_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`status` text NOT NULL,
	`owner` text,
	`token` text,
	`expires_at` text,
	`progress` text NOT NULL,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`document_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `research_documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `evaluation_plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA user_version = 4;
