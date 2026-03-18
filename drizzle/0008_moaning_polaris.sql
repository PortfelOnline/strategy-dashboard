CREATE TABLE `savedTopics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`keyword` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `savedTopics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `savedTopics` ADD CONSTRAINT `savedTopics_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;