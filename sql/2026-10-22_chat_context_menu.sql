-- ============================================================
-- 聊天页右键菜单所需的数据库变更
-- 目标库：dailycheck（MySQL 8 / MariaDB 10.4+）
-- 日期：2026-10-22
--
-- 变更内容：
--   1) chat_conversation_members 增加「按用户删除会话」标记：
--        is_hidden                       会话是否从该用户收件箱隐藏
--        history_cleared_before_message_id  仅该用户不可见的消息游标（含该 ID）
--        history_cleared_at              清除时间
--   2) 新建 chat_message_deletions：消息「仅自己不可见」的伪删除标记表
--
-- 说明：本脚本是**一次性迁移**，默认目标库尚未包含这些列/表。
-- ============================================================

ALTER TABLE `chat_conversation_members`
  ADD COLUMN `is_hidden` tinyint(1) NOT NULL DEFAULT 0
    COMMENT '是否对该用户隐藏会话（伪删除标记）' AFTER `is_muted`,
  ADD COLUMN `history_cleared_before_message_id` bigint unsigned DEFAULT NULL
    COMMENT '聊天记录清除到此消息ID（含），仅对该用户生效' AFTER `is_hidden`,
  ADD COLUMN `history_cleared_at` datetime DEFAULT NULL
    COMMENT '聊天记录清除时间（仅该用户）' AFTER `history_cleared_before_message_id`;

CREATE TABLE IF NOT EXISTS `chat_message_deletions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `message_id` bigint unsigned NOT NULL COMMENT '被隐藏的消息ID',
  `user_id` bigint unsigned NOT NULL COMMENT '执行隐藏的用户ID（仅该用户不可见）',
  `reason` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '删除原因说明',
  `deleted_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '删除（隐藏）时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_chat_message_deletions_message_user` (`message_id`, `user_id`),
  KEY `idx_chat_message_deletions_user` (`user_id`),
  CONSTRAINT `fk_chat_message_deletions_message` FOREIGN KEY (`message_id`)
    REFERENCES `chat_messages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_chat_message_deletions_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='聊天消息按用户伪删除标记表（仅删除者不可见）';

-- 可选：为高频查询补一个「用户 + 会话」的索引，便于按用户过滤隐藏会话。
-- 已有 idx_chat_members_user_active / idx_chat_members_user_left_conversation，
-- 这里不再重复创建。

-- ============================================================
-- 回滚（如需）：
-- DROP TABLE IF EXISTS `chat_message_deletions`;
-- ALTER TABLE `chat_conversation_members`
--   DROP COLUMN `history_cleared_at`,
--   DROP COLUMN `history_cleared_before_message_id`,
--   DROP COLUMN `is_hidden`;
-- ============================================================
