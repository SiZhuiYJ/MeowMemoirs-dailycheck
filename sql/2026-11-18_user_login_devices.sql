-- ============================================================
-- 登录记录 v2：登录设备表 user_login_devices + user_login_records.device_id
-- 目标库：dailycheck（MySQL 8 / MariaDB 10.4+，utf8mb4）
-- 日期：2026-11-18
--
-- 变更内容：
--   1. 新增 user_login_devices：一台设备一行，(user_id, device_key) 唯一；
--      device_key 来自客户端持久化的 X-Device-Id 头，旧客户端用 UA 指纹兜底。
--   2. user_login_records 增加 device_id（目标登录设备），并补索引 / 外键。
--   3. 迁移既有真实数据（不能丢）：旧记录没有设备 ID，按
--      (user_id, platform, device) 分组生成「legacy:<md5>」设备并回填 device_id。
--      本地库 user 11 的 5 条记录 → 2 台设备（Chrome · Windows 3 条 / Android 10 2 条）。
--
-- 说明：
--   · 本脚本可在已初始化的库上**重复执行**：建表用 IF NOT EXISTS、加列用
--     ADD COLUMN IF NOT EXISTS、索引 / 外键用 information_schema 判存在、
--     device_id 改 NOT NULL 仅在已无 NULL 时执行；回填只处理 device_id IS NULL 的行。
--   · 表快照已同步到 sql/2026-11-04_schema_01_user.sql（user_activity 之后）。
--   · 时间统一存 UTC（库会话 SET TIME_ZONE='+00:00'，代码 DateTime.UtcNow）。
--   · 执行：mariadb -u root -p dailycheck < sql/2026-11-18_user_login_devices.sql
-- ============================================================

SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- 1) 登录设备表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_login_devices` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` bigint(20) unsigned NOT NULL COMMENT '用户ID',
  `device_key` varchar(64) NOT NULL COMMENT '客户端持久化设备ID（X-Device-Id 头，或 UA 指纹兜底）',
  `device` varchar(128) NOT NULL DEFAULT '' COMMENT '设备展示名（最近一次登录）',
  `platform` varchar(32) NOT NULL DEFAULT 'unknown' COMMENT '平台（最近一次登录）',
  `first_login_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '首次登录时间（UTC）',
  `last_login_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '最后一次登录时间（UTC）',
  `last_login_record_id` bigint(20) unsigned DEFAULT NULL COMMENT '最后一次登录记录ID（user_login_records.id）',
  `created_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '创建时间（UTC）',
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() COMMENT '更新时间（UTC）',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_login_devices_user_key` (`user_id`,`device_key`),
  KEY `idx_login_devices_user_last` (`user_id`,`last_login_at`),
  CONSTRAINT `fk_login_devices_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户登录设备表';

-- ------------------------------------------------------------
-- 2) user_login_records 增加 device_id
-- ------------------------------------------------------------
ALTER TABLE `user_login_records`
  ADD COLUMN IF NOT EXISTS `device_id` bigint(20) unsigned NULL
    COMMENT '目标登录设备ID（user_login_devices.id）' AFTER `user_id`;

-- ------------------------------------------------------------
-- 3) 旧数据回填：按 (user_id, platform, device) 分组生成 legacy 设备
--    只处理 device_id IS NULL 的旧记录，重复执行时为空操作。
-- ------------------------------------------------------------
INSERT INTO `user_login_devices`
  (`user_id`, `device_key`, `device`, `platform`, `first_login_at`, `last_login_at`, `last_login_record_id`)
SELECT
  r.`user_id`,
  CONCAT('legacy:', MD5(CONCAT(r.`user_id`, '|', r.`platform`, '|', r.`device`))) AS `device_key`,
  r.`device`,
  r.`platform`,
  MIN(r.`login_at`) AS `first_login_at`,
  MAX(r.`login_at`) AS `last_login_at`,
  (SELECT r2.`id`
     FROM `user_login_records` r2
    WHERE r2.`user_id` = r.`user_id`
      AND r2.`platform` = r.`platform`
      AND r2.`device` = r.`device`
    ORDER BY r2.`login_at` DESC, r2.`id` DESC
    LIMIT 1) AS `last_login_record_id`
FROM `user_login_records` r
WHERE r.`device_id` IS NULL
GROUP BY r.`user_id`, r.`platform`, r.`device`
ON DUPLICATE KEY UPDATE
  `last_login_record_id` = IF(VALUES(`last_login_at`) >= `last_login_at`,
                              VALUES(`last_login_record_id`),
                              `last_login_record_id`),
  `first_login_at` = LEAST(`first_login_at`, VALUES(`first_login_at`)),
  `last_login_at` = GREATEST(`last_login_at`, VALUES(`last_login_at`)),
  `device` = VALUES(`device`),
  `platform` = VALUES(`platform`),
  `updated_at` = CURRENT_TIMESTAMP;

-- 回填 records.device_id（重复执行时为空操作）
UPDATE `user_login_records` r
JOIN `user_login_devices` d
  ON d.`user_id` = r.`user_id`
 AND d.`device_key` = CONCAT('legacy:', MD5(CONCAT(r.`user_id`, '|', r.`platform`, '|', r.`device`)))
SET r.`device_id` = d.`id`
WHERE r.`device_id` IS NULL;

-- ------------------------------------------------------------
-- 4) 补索引 / 外键（information_schema 判存在，重复执行不报错）
-- ------------------------------------------------------------
SET @has_device_index := (
  SELECT COUNT(*)
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'user_login_records'
     AND INDEX_NAME = 'idx_login_records_device_time'
);
SET @sql := IF(@has_device_index = 0,
  'ALTER TABLE `user_login_records` ADD KEY `idx_login_records_device_time` (`device_id`,`login_at`)',
  'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_device_fk := (
  SELECT COUNT(*)
    FROM information_schema.TABLE_CONSTRAINTS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'user_login_records'
     AND CONSTRAINT_NAME = 'fk_login_records_device'
     AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql := IF(@has_device_fk = 0,
  'ALTER TABLE `user_login_records` ADD CONSTRAINT `fk_login_records_device` FOREIGN KEY (`device_id`) REFERENCES `user_login_devices` (`id`) ON DELETE CASCADE',
  'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 5) 回填完成后把 device_id 改成 NOT NULL（仅在已无 NULL 时执行）
-- ------------------------------------------------------------
SET @null_device_rows := (
  SELECT COUNT(*) FROM `user_login_records` WHERE `device_id` IS NULL
);
SET @device_id_nullable := (
  SELECT IS_NULLABLE
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'user_login_records'
     AND COLUMN_NAME = 'device_id'
);
SET @sql := IF(@null_device_rows = 0 AND @device_id_nullable = 'YES',
  'ALTER TABLE `user_login_records` MODIFY `device_id` bigint(20) unsigned NOT NULL COMMENT ''目标登录设备ID（user_login_devices.id）''',
  'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 6) 迁移结果自检（仅输出，不修改数据）
-- ------------------------------------------------------------
SELECT 'user_login_devices' AS `table_name`, COUNT(*) AS `row_count` FROM `user_login_devices`
UNION ALL
SELECT 'user_login_records', COUNT(*) FROM `user_login_records`
UNION ALL
SELECT 'records_device_id_null', COUNT(*) FROM `user_login_records` WHERE `device_id` IS NULL;

SELECT IF(@null_device_rows = 0,
          'OK: device_id 已全部回填且为 NOT NULL',
          CONCAT('WARN: 仍有 ', @null_device_rows, ' 条记录 device_id 为 NULL（未改成 NOT NULL）')) AS `migration_status`;

-- ============================================================
-- 回滚（如需，会丢设备关联，请先备份）：
-- ALTER TABLE `user_login_records` DROP FOREIGN KEY `fk_login_records_device`;
-- ALTER TABLE `user_login_records` DROP KEY `idx_login_records_device_time`;
-- ALTER TABLE `user_login_records` DROP COLUMN `device_id`;
-- DROP TABLE IF EXISTS `user_login_devices`;
-- ============================================================
