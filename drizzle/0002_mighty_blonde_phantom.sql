CREATE TABLE `metaAccounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`accountType` enum('facebook_page','instagram_business') NOT NULL,
	`accountId` varchar(255) NOT NULL,
	`accountName` varchar(255) NOT NULL,
	`accessToken` text NOT NULL,
	`refreshToken` text,
	`expiresAt` timestamp,
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `metaAccounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `metaAccounts` ADD CONSTRAINT `metaAccounts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;