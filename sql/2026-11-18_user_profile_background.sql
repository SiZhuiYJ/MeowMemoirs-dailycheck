-- ============================================================
-- 个人主页背景图（users.profile_background_key）
-- 目标库：dailycheck（MySQL 8 / MariaDB 10.4+）
-- 日期：2026-11-18
--
-- 变更内容：
--   users 增加 profile_background_key：个人主页（小程序 /pages/profile/index
--   的头像卡）自定义背景图的存储标识，NULL 表示未设置（前端回退用头像图）。
--
-- 说明：
--   · 背景图文件本身仍放在公开用户目录 uploads/public/users/{userId}/，
--     与头像同目录、内容哈希命名，通过 GET /mm/Files/users/{userId}/{key}
--     公开读取；本列只存文件 key。
--   · 本脚本是**一次性迁移**，默认目标库尚未包含该列。
--   · 执行：mysql -u root dailycheck < sql/2026-11-18_user_profile_background.sql
-- ============================================================

ALTER TABLE `users`
  ADD COLUMN `profile_background_key` varchar(512) DEFAULT NULL
    COMMENT '个人主页背景图存储标识' AFTER `avatar_key`;

-- ============================================================
-- 回滚（如需）：
-- ALTER TABLE `users` DROP COLUMN `profile_background_key`;
-- ============================================================
