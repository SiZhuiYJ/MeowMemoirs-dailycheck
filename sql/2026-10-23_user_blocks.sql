-- ============================================================
-- 用户拉黑（用户级黑名单）
-- 目标库：dailycheck（MySQL 8 / MariaDB 10.4+）
-- 日期：2026-10-23
--
-- 变更内容：
--   新建 user_blocks：记录「谁拉黑了谁」（按拉黑方方向存储）。
--
-- 语义：
--   · 被拉黑方无法再对拉黑方发起好友申请、单聊，也无法搜索到拉黑方；
--     （主页仍可查看，前端通过 isBlockedByTarget 提示并禁用互动）
--   · 被拉黑方的好友列表中不再显示拉黑方，但 user_friendships 不删除（好友状态保持）；
--   · 拉黑方仍可查看被拉黑方主页；
--   · 双方共同所在的群聊不受影响。
--
-- 说明：本脚本是**一次性迁移**，默认目标库尚未包含该表。
-- ============================================================

CREATE TABLE IF NOT EXISTS `user_blocks` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` bigint unsigned NOT NULL COMMENT '拉黑方用户ID',
  `blocked_user_id` bigint unsigned NOT NULL COMMENT '被拉黑用户ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '拉黑时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_user_blocks_user_blocked` (`user_id`, `blocked_user_id`),
  KEY `idx_user_blocks_blocked` (`blocked_user_id`),
  CONSTRAINT `fk_user_blocks_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_blocks_blocked` FOREIGN KEY (`blocked_user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='用户拉黑关系表（按拉黑方方向存储）';

-- ============================================================
-- 回滚（如需）：
-- DROP TABLE IF EXISTS `user_blocks`;
-- ============================================================
