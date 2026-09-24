-- Custom SQL migration file.
CREATE TABLE `seo_page_snapshots` (
  `id` int AUTO_INCREMENT NOT NULL,
  `url` varchar(512) NOT NULL,
  `segment` enum('article','news','reestr','other') NOT NULL,
  `source` enum('google','yandex') NOT NULL,
  `period_start` timestamp NOT NULL,
  `period_end` timestamp NOT NULL,
  `impressions` int NOT NULL DEFAULT 0,
  `clicks` int NOT NULL DEFAULT 0,
  `ctr` double NOT NULL DEFAULT 0,
  `position` double,
  `index_status` varchar(128),
  `captured_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `seo_page_snapshots_id` PRIMARY KEY(`id`),
  CONSTRAINT `seo_page_snapshots_url_source_period_end_unique` UNIQUE(`url`,`source`,`period_end`)
);

CREATE INDEX `seo_page_snapshots_url_source_period_end_idx`
  ON `seo_page_snapshots` (`url`,`source`,`period_end`);

CREATE TABLE `seo_page_queries` (
  `id` int AUTO_INCREMENT NOT NULL,
  `snapshot_id` int NOT NULL,
  `query` varchar(512) NOT NULL,
  `impressions` int NOT NULL DEFAULT 0,
  `clicks` int NOT NULL DEFAULT 0,
  `ctr` double NOT NULL DEFAULT 0,
  `position` double,
  CONSTRAINT `seo_page_queries_id` PRIMARY KEY(`id`),
  CONSTRAINT `seo_page_queries_snapshot_id_seo_page_snapshots_id_fk`
    FOREIGN KEY (`snapshot_id`) REFERENCES `seo_page_snapshots`(`id`) ON DELETE cascade
);

CREATE INDEX `seo_page_queries_snapshot_idx` ON `seo_page_queries` (`snapshot_id`);

CREATE TABLE `seo_improvement_cycles` (
  `id` int AUTO_INCREMENT NOT NULL,
  `url` varchar(512) NOT NULL,
  `segment` enum('article','news','reestr','other') NOT NULL,
  `snapshot_before_id` int,
  `snapshot_after_id` int,
  `hypothesis` enum('intent_gap','snippet','ctr_metadata','internal_links','freshness','content_quality') NOT NULL,
  `status` enum('queued','published','measuring','won','lost','inconclusive') NOT NULL DEFAULT 'queued',
  `outcome_reason` text,
  `before_content_hash` varchar(64),
  `after_content_hash` varchar(64),
  `queued_at` timestamp NOT NULL DEFAULT (now()),
  `published_at` timestamp,
  `next_measurement_at` timestamp,
  `cooldown_until` timestamp,
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `seo_improvement_cycles_id` PRIMARY KEY(`id`),
  CONSTRAINT `seo_improvement_cycles_snapshot_before_id_seo_page_snapshots_id_fk`
    FOREIGN KEY (`snapshot_before_id`) REFERENCES `seo_page_snapshots`(`id`),
  CONSTRAINT `seo_improvement_cycles_snapshot_after_id_seo_page_snapshots_id_fk`
    FOREIGN KEY (`snapshot_after_id`) REFERENCES `seo_page_snapshots`(`id`)
);

CREATE INDEX `seo_improvement_cycles_url_status_idx`
  ON `seo_improvement_cycles` (`url`,`status`);
CREATE INDEX `seo_improvement_cycles_measurement_idx`
  ON `seo_improvement_cycles` (`next_measurement_at`);
