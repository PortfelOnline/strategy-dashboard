CREATE TABLE `articleAnalyses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`url` varchar(512) NOT NULL,
	`originalTitle` varchar(512) NOT NULL,
	`originalContent` text NOT NULL,
	`wordCount` int NOT NULL DEFAULT 0,
	`improvedTitle` varchar(512) NOT NULL,
	`improvedContent` text NOT NULL,
	`metaTitle` varchar(512),
	`metaDescription` text,
	`keywords` text,
	`generalSuggestions` text,
	`headings` text,
	`seoScore` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `articleAnalyses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `articleAnalyses` ADD CONSTRAINT `articleAnalyses_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;