CREATE TABLE `wordpressAccounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`siteUrl` varchar(512) NOT NULL,
	`siteName` varchar(255) NOT NULL,
	`username` varchar(255) NOT NULL,
	`appPassword` text NOT NULL,
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `wordpressAccounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `wordpressAccounts` ADD CONSTRAINT `wordpressAccounts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;