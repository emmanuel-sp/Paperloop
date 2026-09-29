CREATE TABLE `implementation_briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`document_id` text NOT NULL,
	`version` integer NOT NULL,
	`summary` text NOT NULL,
	`applicability` text NOT NULL,
	`proposed_changes` text NOT NULL,
	`risks` text NOT NULL,
	`evaluation_ideas` text NOT NULL,
	`source_claims` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `research_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `implementation_briefs_project_document_version_unique` ON `implementation_briefs` (`project_id`,`document_id`,`version`);--> statement-breakpoint
CREATE TABLE `project_research_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`document_id` text NOT NULL,
	`submitted_by` text NOT NULL,
	`added_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `research_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_research_documents_membership_unique` ON `project_research_documents` (`project_id`,`document_id`);--> statement-breakpoint
CREATE TABLE `research_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_reference` text NOT NULL,
	`canonical_url` text,
	`authors` text NOT NULL,
	`source_version` text,
	`extraction_status` text NOT NULL,
	`extracted_content_reference` text,
	`extraction_error` text,
	`retrieved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `research_documents_source_identity_unique` ON `research_documents` (`source_kind`,`source_reference`);--> statement-breakpoint
PRAGMA user_version = 3;
