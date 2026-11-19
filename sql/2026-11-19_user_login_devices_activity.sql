-- ============================================================
-- 登录设备「最后活跃时间」（user_login_devices.last_active_at）
-- 目标库：dailycheck（MySQL 8 / MariaDB 10.4+，utf8mb4）
-- 日期：2026-11-19
--
-- 变更内容：
--   user_login_devices 增加 last_active_at：打开小程序 / 网页（含登录）时更新，
--   用于设备列表展示「最后活跃时间」，并作为设备列表默认排序依据。
--
-- 说明：
--   · 本脚本可在已初始化的库上**重复执行**：
--       ADD COLUMN IF NOT EXISTS → 回填 NULL → MODIFY NOT NULL DEFAULT current_timestamp；
--     历史设备没有活跃时间，回填为 last_login_at（首次登录时间兜底）。
--   · 表快照已同步到 sql/2026-11-04_schema_01_user.sql（devices 表）。
--   · 时间统一存 UTC（库会话 SET TIME_ZONE='+00:00'，代码 DateTime.UtcNow）。
--   · 执行：mariadb -u root -p dailycheck < sql/2026-11-19_user_login_devices_activity.sql
-- ============================================================

SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- 1) 加列（先可空，便于回填历史数据）
-- ------------------------------------------------------------
ALTER TABLE `user_login_devices`
  ADD COLUMN IF NOT EXISTS `last_active_at` datetime NULL
    COMMENT '最后活跃时间（UTC，打开小程序/网页时更新）' AFTER `last_login_at`;

-- ------------------------------------------------------------
-- 2) 回填：历史设备用最后登录时间兜底（重复执行时为空操作）
-- ------------------------------------------------------------
UPDATE `user_login_devices`
   SET `last_active_at` = `last_login_at`
 WHERE `last_active_at` IS NULL;

-- ------------------------------------------------------------
-- 3) 回填完成后改为 NOT NULL DEFAULT current_timestamp（可重复执行）
-- ------------------------------------------------------------
ALTER TABLE `user_login_devices`
  MODIFY `last_active_at` datetime NOT NULL DEFAULT current_timestamp()
    COMMENT '最后活跃时间（UTC，打开小程序/网页时更新）';

-- ------------------------------------------------------------
-- 4) 迁移结果自检（仅输出，不修改数据）
-- ------------------------------------------------------------
SELECT COUNT(*) AS `devices_total`,
       IFNULL(SUM(`last_active_at` IS NULL), 0) AS `null_last_active_at`,
       IFNULL(SUM(`last_active_at` = `last_login_at`), 0) AS `active_equals_login`
  FROM `user_login_devices`;

SELECT IF(IFNULL(SUM(`last_active_at` IS NULL), 0) = 0,
          'OK: last_active_at 已全部回填且为 NOT NULL',
          CONCAT('WARN: 仍有 ', SUM(`last_active_at` IS NULL), ' 台设备 last_active_at 为 NULL'))
       AS `migration_status`
  FROM `user_login_devices`;

-- ============================================================
-- 回滚（如需）：
-- ALTER TABLE `user_login_devices` DROP COLUMN `last_active_at`;
-- ============================================================
