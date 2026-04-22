CREATE TABLE `backlinkPosts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platform` enum('dzen','spark','kw') NOT NULL,
	`targetUrl` varchar(512) NOT NULL,
	`anchorText` varchar(512) NOT NULL,
	`title` varchar(512),
	`article` text,
	`status` enum('pending','publishing','published','failed') NOT NULL DEFAULT 'pending',
	`publishedUrl` varchar(512),
	`publishedAt` timestamp,
	`errorMsg` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `backlinkPosts_id` PRIMARY KEY(`id`)
);
