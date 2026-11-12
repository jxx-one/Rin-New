-- 文章附件元数据表。
-- 文件实体保存在私有对象存储中，storage_key 只供服务端鉴权下载使用，不返回前台。
CREATE TABLE IF NOT EXISTS `feed_attachments` (
	`id` integer PRIMARY KEY NOT NULL,
	`feed_id` integer NOT NULL,
	`storage_key` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text DEFAULT 'application/octet-stream' NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `feed_attachments_feed_created_at_idx`
	ON `feed_attachments` (`feed_id`, `created_at`);
--> statement-breakpoint
UPDATE `info` SET `value` = '15' WHERE `key` = 'migration_version';
