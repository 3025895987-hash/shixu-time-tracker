CREATE TABLE `changes` (
	`revision` integer PRIMARY KEY NOT NULL,
	`token` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `changes_token_unique` ON `changes` (`token`);--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`mode` text NOT NULL,
	`start` integer,
	`end` integer,
	`day` text,
	`minutes` integer
);
--> statement-breakpoint
CREATE INDEX `record_start` ON `records` (`start`);--> statement-breakpoint
CREATE INDEX `record_day` ON `records` (`day`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_running_timer` ON `records` (`mode`) WHERE mode = 'timer' AND end IS NULL;--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
