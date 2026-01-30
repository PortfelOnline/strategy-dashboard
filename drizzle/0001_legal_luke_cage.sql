CREATE TABLE `contentPosts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`templateId` int,
	`title` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`platform` enum('facebook','instagram','whatsapp') NOT NULL,
	`language` varchar(50) NOT NULL DEFAULT 'hinglish',
	`status` enum('draft','scheduled','published','archived') NOT NULL DEFAULT 'draft',
	`scheduledAt` timestamp,
	`publishedAt` timestamp,
	`hashtags` text,
	`mediaUrl` varchar(512),
	`engagement` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `contentPosts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contentTemplates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`pillarType` enum('desi_business_owner','five_minute_transformation','roi_calculator') NOT NULL,
	`platform` enum('facebook','instagram','whatsapp','all') NOT NULL,
	`language` enum('hinglish','hindi','english','tamil','telugu','bengali') NOT NULL DEFAULT 'hinglish',
	`prompt` text NOT NULL,
	`description` text,
	`isPublic` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `contentTemplates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `contentPosts` ADD CONSTRAINT `contentPosts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contentPosts` ADD CONSTRAINT `contentPosts_templateId_contentTemplates_id_fk` FOREIGN KEY (`templateId`) REFERENCES `contentTemplates`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contentTemplates` ADD CONSTRAINT `contentTemplates_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;