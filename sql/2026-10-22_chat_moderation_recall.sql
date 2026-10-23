-- ============================================================
-- 群聊「管理撤回」提示落到原消息位置
-- 目标库：dailycheck（MySQL 8 / MariaDB 10.4+）
-- 日期：2026-10-22
--
-- 变更内容：
--   chat_messages 增加：
--     recalled_by_user_id  执行撤回的用户ID（管理撤回时为操作人）
--     recall_prompt        管理撤回提示（在消息原位置展示，不再追加底部系统消息）
--
-- 说明：本脚本是**一次性迁移**；已经执行过
-- `2026-10-22_chat_context_menu.sql` 的环境只需要再执行本脚本。
-- ============================================================

ALTER TABLE `chat_messages`
  ADD COLUMN `recalled_by_user_id` bigint unsigned DEFAULT NULL
    COMMENT '执行撤回的用户ID' AFTER `recalled_at`,
  ADD COLUMN `recall_prompt` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL
    COMMENT '管理撤回提示（在原消息位置展示）' AFTER `recalled_by_user_id`,
  ADD KEY `idx_chat_messages_recalled_by` (`recalled_by_user_id`),
  ADD CONSTRAINT `fk_chat_messages_recalled_by` FOREIGN KEY (`recalled_by_user_id`)
    REFERENCES `users` (`id`) ON DELETE SET NULL;

-- ============================================================
-- 回滚（如需）：
-- ALTER TABLE `chat_messages`
--   DROP FOREIGN KEY `fk_chat_messages_recalled_by`,
--   DROP KEY `idx_chat_messages_recalled_by`,
--   DROP COLUMN `recall_prompt`,
--   DROP COLUMN `recalled_by_user_id`;
-- ============================================================
