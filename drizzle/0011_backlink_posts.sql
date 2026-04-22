CREATE TABLE `backlink_posts` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `platform` enum('dzen','spark','kw') NOT NULL,
  `target_url` varchar(512) NOT NULL,
  `anchor_text` varchar(512) NOT NULL,
  `title` varchar(512),
  `article` text,
  `status` enum('pending','publishing','published','failed') NOT NULL DEFAULT 'pending',
  `published_url` varchar(512),
  `published_at` timestamp NULL,
  `error_msg` text,
  `created_at` timestamp DEFAULT (now()) NOT NULL
);

CREATE INDEX `idx_backlink_posts_platform_status`
  ON `backlink_posts`(`platform`, `status`);
