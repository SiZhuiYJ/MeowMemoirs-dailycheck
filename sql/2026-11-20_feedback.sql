-- ============================================================
-- 意见反馈模块建表脚本（feedbacks）
--
-- 用途：小程序 / 网页设置页的「意见反馈」（普通用户提交 + 我的反馈）
-- 与管理员「查看意见」（列表 + 回复）。
--
-- 设计要点：
--   · 一条反馈一行；管理员回复直接写在同一条记录上（reply_content / replied_by_user_id /
--     replied_at），不另建回复表：当前业务只允许「一条反馈一次回复」，重复回复视为覆盖，
--     单表能少一次 join，也方便前端一次拿全。
--   · status 只作为查询/前端 tab 的冗余状态字段（pending 待回复 / replied 已回复），
--     真正的「是否已回复」以 reply_content 是否为空为准；管理员回复时两者一起维护。
--   · user_id 外键 ON DELETE CASCADE：用户被物理删除时其反馈一并删除；
--     replied_by_user_id ON DELETE SET NULL：管理员账号被删除后保留历史回复内容，只是丢失回复人。
--   · is_deleted 伪删除：反馈下架用软删除，便于事后追溯（当前接口没有删除入口，预留字段）。
--   · 时间一律存 UTC（与项目其它模块一致），展示时由客户端转本地时区。
--
-- 幂等：可重复执行（CREATE TABLE IF NOT EXISTS）。
-- 执行：mariadb -u root -p"$(cat ~/.config/notebook/db_password)" dailycheck < sql/2026-11-20_feedback.sql
-- ============================================================

USE `dailycheck`;

-- 用户意见反馈（用户提交 + 管理员回复）
CREATE TABLE IF NOT EXISTS `feedbacks` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '反馈ID',
    `user_id` bigint unsigned NOT NULL COMMENT '提交用户ID',
    `content` varchar(2000) NOT NULL COMMENT '反馈内容',
    `contact` varchar(128) DEFAULT NULL COMMENT '联系方式（可选）',
    `app` enum('web','mp') NOT NULL DEFAULT 'web' COMMENT '来源端：web 网页，mp 小程序',
    `status` enum('pending','replied') NOT NULL DEFAULT 'pending' COMMENT '处理状态：pending 待回复，replied 已回复',
    `reply_content` varchar(2000) DEFAULT NULL COMMENT '管理员回复内容',
    `replied_by_user_id` bigint unsigned DEFAULT NULL COMMENT '回复管理员ID',
    `replied_at` datetime DEFAULT NULL COMMENT '回复时间',
    `is_deleted` tinyint NOT NULL DEFAULT 0 COMMENT '0-正常 1-删除',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '提交时间',
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    -- 用户「我的反馈」：按 user_id 过滤 + created_at 倒序分页
    KEY `idx_feedbacks_user_created` (`user_id`, `created_at`),
    -- 管理员列表：按 status 筛选 + created_at 倒序分页
    KEY `idx_feedbacks_status_created` (`status`, `created_at`),
    CONSTRAINT `fk_feedbacks_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_feedbacks_replier` FOREIGN KEY (`replied_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '用户意见反馈';
