CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_name_unique` ON `companies` (`name`);--> statement-breakpoint
CREATE TABLE `complaints` (
	`complaint_id` integer PRIMARY KEY NOT NULL,
	`date_received` text NOT NULL,
	`date_sent_to_company` text,
	`product_id` integer,
	`sub_product_id` integer,
	`issue_id` integer,
	`sub_issue_id` integer,
	`company_id` integer,
	`company_public_response` text,
	`company_response` text,
	`timely_response` integer,
	`state` text,
	`zip_code` text,
	`tags` text,
	`submitted_via` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`sub_product_id`) REFERENCES `sub_products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`sub_issue_id`) REFERENCES `sub_issues`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `complaints_date_received_idx` ON `complaints` (`date_received`);--> statement-breakpoint
CREATE INDEX `complaints_company_id_idx` ON `complaints` (`company_id`);--> statement-breakpoint
CREATE INDEX `complaints_product_id_idx` ON `complaints` (`product_id`);--> statement-breakpoint
CREATE INDEX `complaints_sub_product_id_idx` ON `complaints` (`sub_product_id`);--> statement-breakpoint
CREATE INDEX `complaints_issue_id_idx` ON `complaints` (`issue_id`);--> statement-breakpoint
CREATE INDEX `complaints_sub_issue_id_idx` ON `complaints` (`sub_issue_id`);--> statement-breakpoint
CREATE INDEX `complaints_state_idx` ON `complaints` (`state`);--> statement-breakpoint
CREATE TABLE `issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issues_name_unique` ON `issues` (`name`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_name_unique` ON `products` (`name`);--> statement-breakpoint
CREATE TABLE `sub_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`issue_id` integer NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sub_issues_issue_id_idx` ON `sub_issues` (`issue_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sub_issues_issue_name_unique` ON `sub_issues` (`issue_id`,`name`);--> statement-breakpoint
CREATE TABLE `sub_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sub_products_product_id_idx` ON `sub_products` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sub_products_product_name_unique` ON `sub_products` (`product_id`,`name`);