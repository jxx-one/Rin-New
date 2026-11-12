-- The CLI migration preflight adds feeds.password_hash when it is missing. Keeping
-- that check outside SQL avoids SQLite's unsupported `ADD COLUMN IF NOT EXISTS`
-- syntax and lets re-running this migration stay safe.

UPDATE `info` SET `value` = '14' WHERE `key` = 'migration_version';
