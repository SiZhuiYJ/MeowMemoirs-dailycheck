-- ============================================================
-- 上次头像回退（users.previous_avatar_key）
-- 目标库：dailycheck（MySQL 8 / MariaDB 10.4+）
-- 日期：2026-11-19
--
-- 变更内容：
--   users 增加 previous_avatar_key：记录「上一次使用的头像」存储标识，
--   供小程序 / Web 的「使用上次头像」功能一键切回（与当前头像互换），
--   NULL 表示没有可回退的上次头像（从未换过头像 / 已被切回消耗）。
--
-- 说明：
--   头像文件本身仍放在公开用户目录 uploads/public/users/{userId}/，
--   本列只存文件 key；写入新头像时由服务端自动把旧 avatar_key 记到本列。
--   本脚本是**一次性迁移**，默认目标库尚未包含该列。
--   执行：mysql -u root dailycheck < sql/2026-11-19_user_previous_avatar.sql
-- ============================================================

ALTER TABLE `users`
  ADD COLUMN `previous_avatar_key` varchar(512) DEFAULT NULL
    COMMENT '上一次使用的头像存储标识（用于切回）' AFTER `avatar_key`;

-- ============================================================
-- 回滚（如需）：
-- ALTER TABLE `users` DROP COLUMN `previous_avatar_key`;
-- ============================================================
