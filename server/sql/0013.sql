-- The CLI migration preflight adds feeds.sort_order when it is missing. Keeping
-- that check outside SQL avoids SQLite's unsupported `ADD COLUMN IF NOT EXISTS`
-- syntax and lets re-running this migration stay safe.

DROP INDEX IF EXISTS `feeds_visibility_order_idx`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `feeds_visibility_order_idx` ON `feeds` (`draft`, `listed`, `top`, `sort_order`, `created_at`, `updated_at`);
--> statement-breakpoint
UPDATE `info` SET `value` = '13' WHERE `key` = 'migration_version';
