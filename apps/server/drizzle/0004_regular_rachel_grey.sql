CREATE TABLE `discovery_scans` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_source_selections` (
	`project_id` text PRIMARY KEY NOT NULL,
	`selection` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recommendation_triage` (
	`id` text PRIMARY KEY NOT NULL,
	`recommendation_id` text NOT NULL,
	`state` text NOT NULL,
	`reason` text NOT NULL,
	`experiment_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`recommendation_id`) REFERENCES `research_recommendations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `research_recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`document_id` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `research_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recommendation_project_document_unique` ON `research_recommendations` (`project_id`,`document_id`);--> statement-breakpoint
CREATE TABLE `research_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`source_version` text,
	`extraction_status` text NOT NULL,
	`extraction_error` text,
	`content_reference` text,
	`retrieved_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `research_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE VIRTUAL TABLE research_search USING fts5(document_id UNINDEXED, title, authors, content, tokenize='unicode61');
--> statement-breakpoint
INSERT INTO research_search (document_id, title, authors, content) SELECT id, title, authors, '' FROM research_documents;
--> statement-breakpoint
INSERT INTO research_versions (id, document_id, source_version, extraction_status, extraction_error, content_reference, retrieved_at)
SELECT id, id, source_version, extraction_status, extraction_error, extracted_content_reference, strftime('%Y-%m-%dT%H:%M:%fZ', updated_at / 1000.0, 'unixepoch') FROM research_documents;
--> statement-breakpoint
PRAGMA user_version = 5;
