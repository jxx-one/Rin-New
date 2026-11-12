-- 用户体系：邮箱字段与邮箱验证码记录。
-- 邮箱统一按小写保存；唯一索引允许多个 NULL，因此未绑定邮箱的历史用户不会冲突。
ALTER TABLE `users` ADD COLUMN `email` text;
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `email_verified_at` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_email_unique`
	ON `users` (`email`);
--> statement-breakpoint

-- 邮箱验证码记录：同一邮箱、同一用途可保留多条历史记录，校验时取最新未消费的一条。
CREATE TABLE IF NOT EXISTS `email_verifications` (
	`id` integer PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`purpose` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`consumed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `email_verifications_email_purpose_created_idx`
	ON `email_verifications` (`email`, `purpose`, `created_at`);
--> statement-breakpoint
UPDATE `info` SET `value` = '16' WHERE `key` = 'migration_version';
