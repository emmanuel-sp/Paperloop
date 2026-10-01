CREATE TABLE `api_activations` (
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_activation_unique` ON `api_activations` (`project_id`,`provider`);--> statement-breakpoint
CREATE TABLE `automation_experiments` (
	`experiment_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`recommendation_id` text NOT NULL,
	`max_runs` integer NOT NULL,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recommendation_id`) REFERENCES `research_recommendations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automated_recommendation_unique` ON `automation_experiments` (`project_id`,`recommendation_id`);--> statement-breakpoint
CREATE TABLE `automation_rules` (
	`project_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`approved_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `schedule_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`revision` integer NOT NULL,
	`occurrence` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_occurrence_unique` ON `schedule_jobs` (`schedule_id`,`revision`,`occurrence`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);

--> statement-breakpoint
PRAGMA user_version = 6;
