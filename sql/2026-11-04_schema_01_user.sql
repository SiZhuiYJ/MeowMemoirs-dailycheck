-- ============================================================
-- 用户与账号（仅结构（不含数据））
-- 目标库：dailycheck（MySQL 8 / MariaDB 10.4+，utf8mb4）
-- 生成时间：2026-11-04 13:12:23 +0000
-- 内容：用户主表、第三方登录、好友关系/申请、拉黑、行为日志
--
-- 【不含数据】可直接入库、分发给他人部署；真实数据备份见 sql/private/。
--
-- 表清单：
--   users
--   user_oauth_accounts
--   user_friendships
--   user_friend_requests
--   user_blocks
--   user_blacklist_records
--   soft_delete_logs
--   user_activity
--   user_login_records
--   __efmigrationshistory
--
-- 恢复顺序：01_user → 02_chat → 03_checkin
--   mysql -h127.0.0.1 -uroot -p < 2026-11-04_schema_01_user.sql
-- 均自带 CREATE DATABASE IF NOT EXISTS 与 FOREIGN_KEY_CHECKS 开关，
-- 可整组重放，也可单独重放（单独重放 02/03 前请确保 01 已导入，否则外键会失败）。
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET UNIQUE_CHECKS = 0;
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';

CREATE DATABASE IF NOT EXISTS `dailycheck` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `dailycheck`;

/*M!999999\- enable the sandbox mode */ 

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*M!100616 SET @OLD_NOTE_VERBOSITY=@@NOTE_VERBOSITY, NOTE_VERBOSITY=0 */;
DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `email` varchar(255) DEFAULT NULL COMMENT '用户邮箱（唯一）',
  `password_hash` varchar(255) NOT NULL COMMENT '密码哈希（如bcrypt）',
  `nick_name` varchar(64) DEFAULT NULL COMMENT '用户昵称',
  `avatar_key` varchar(512) DEFAULT NULL COMMENT '头像图片URL',
  `profile_background_key` varchar(512) DEFAULT NULL COMMENT '个人主页背景图存储标识',
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否伪删除：0正常，1已删除',
  `deleted_at` datetime DEFAULT NULL COMMENT '伪删除时间',
  `status` tinyint(1) NOT NULL DEFAULT 1 COMMENT '账户状态：1正常，0冻结',
  `role` enum('user','admin') NOT NULL DEFAULT 'user' COMMENT '用户角色：user普通用户，admin管理员',
  `frozen_at` datetime DEFAULT NULL COMMENT '账户冻结时间',
  `frozen_reason` varchar(255) DEFAULT NULL COMMENT '账户冻结原因',
  `freeze_operator_id` bigint(20) unsigned DEFAULT NULL COMMENT '执行冻结操作的管理员用户ID',
  `created_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() COMMENT '更新时间',
  `user_account` varchar(64) NOT NULL COMMENT '用户账号（唯一）',
  `account_updated_at` datetime DEFAULT NULL COMMENT 'username更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_users_user_account` (`user_account`),
  UNIQUE KEY `ux_users_email` (`email`),
  KEY `idx_users_status` (`status`),
  KEY `idx_users_is_deleted` (`is_deleted`),
  KEY `idx_users_frozen_at` (`frozen_at`),
  KEY `fk_users_freeze_operator` (`freeze_operator_id`),
  CONSTRAINT `fk_users_freeze_operator` FOREIGN KEY (`freeze_operator_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表（支持伪删除与黑名单冻结）';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `user_oauth_accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_oauth_accounts` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` bigint(20) unsigned NOT NULL COMMENT '关联用户ID',
  `provider` enum('wechat','google','apple') NOT NULL COMMENT '第三方登录平台类型',
  `open_id` varchar(255) NOT NULL COMMENT '第三方平台open_id',
  `union_id` varchar(255) DEFAULT NULL COMMENT '第三方平台union_id（可选）',
  `created_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '绑定时间',
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_oauth_provider_open` (`provider`,`open_id`),
  UNIQUE KEY `ux_oauth_provider_union` (`provider`,`union_id`),
  KEY `idx_oauth_user` (`user_id`),
  KEY `idx_oauth_union_id` (`union_id`),
  CONSTRAINT `fk_oauth_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户第三方登录账号绑定表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `user_friendships`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_friendships` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id` bigint(20) unsigned NOT NULL COMMENT '用户ID',
  `friend_user_id` bigint(20) unsigned NOT NULL COMMENT '好友用户ID',
  `source_request_id` bigint(20) unsigned DEFAULT NULL COMMENT '来源好友请求ID',
  `source_conversation_id` bigint(20) unsigned DEFAULT NULL COMMENT '来源群组会话ID',
  `status` enum('active','deleted') NOT NULL DEFAULT 'active' COMMENT '好友关系状态（active-活跃/deleted-已删除）',
  `friend_remark` varchar(64) DEFAULT NULL COMMENT '好友备注',
  `is_starred` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否置顶（0-否/1-是）',
  `is_muted` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否静音（0-否/1-是）',
  `accepted_at` datetime DEFAULT NULL COMMENT '接受时间',
  `created_by_user_id` bigint(20) unsigned DEFAULT NULL COMMENT '创建关系的操作者用户ID',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  `deleted_by_user_id` bigint(20) unsigned DEFAULT NULL COMMENT '删除关系的操作者用户ID',
  `created_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_friendships_user_friend` (`user_id`,`friend_user_id`),
  KEY `idx_friendships_user_status` (`user_id`,`status`),
  KEY `idx_friendships_friend_status` (`friend_user_id`,`status`),
  KEY `idx_friendships_source_request` (`source_request_id`),
  KEY `idx_friendships_source_conversation` (`source_conversation_id`),
  KEY `idx_friendships_created_by` (`created_by_user_id`),
  KEY `idx_friendships_deleted_by` (`deleted_by_user_id`),
  KEY `idx_friendships_user_status_order` (`user_id`,`status`,`is_starred` DESC,`accepted_at` DESC,`created_at` DESC),
  CONSTRAINT `fk_friendships_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_friendships_deleted_by` FOREIGN KEY (`deleted_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_friendships_friend` FOREIGN KEY (`friend_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_friendships_source_conversation` FOREIGN KEY (`source_conversation_id`) REFERENCES `chat_conversations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_friendships_source_request` FOREIGN KEY (`source_request_id`) REFERENCES `user_friend_requests` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_friendships_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_friendships_not_self` CHECK (`user_id` <> `friend_user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='好友关系表（按用户方向存储）';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `user_friend_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_friend_requests` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `requester_user_id` bigint(20) unsigned NOT NULL COMMENT '请求者用户ID',
  `receiver_user_id` bigint(20) unsigned NOT NULL COMMENT '接收者用户ID',
  `source_conversation_id` bigint(20) unsigned DEFAULT NULL COMMENT '来源群组会话ID',
  `request_message` varchar(255) DEFAULT NULL COMMENT '请求消息',
  `request_source` enum('account','group','search','system') NOT NULL DEFAULT 'account' COMMENT '请求来源（account-账号/group-群组/search-搜索/system-系统）',
  `request_status` enum('pending','accepted','rejected','cancelled','expired') NOT NULL DEFAULT 'pending' COMMENT '请求状态（pending-待处理/accepted-已接受/rejected-已拒绝/cancelled-已取消/expired-已过期）',
  `handled_by_user_id` bigint(20) unsigned DEFAULT NULL COMMENT '处理者用户ID',
  `handled_at` datetime DEFAULT NULL COMMENT '处理时间',
  `reject_reason` varchar(255) DEFAULT NULL COMMENT '拒绝原因',
  `expire_at` datetime DEFAULT NULL COMMENT '过期时间',
  `created_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_friend_requests_requester_status` (`requester_user_id`,`request_status`,`created_at`),
  KEY `idx_friend_requests_receiver_status` (`receiver_user_id`,`request_status`,`created_at`),
  KEY `idx_friend_requests_pair_status` (`requester_user_id`,`receiver_user_id`,`request_status`),
  KEY `idx_friend_requests_status_expire` (`request_status`,`expire_at`),
  KEY `idx_friend_requests_source_conversation` (`source_conversation_id`),
  KEY `idx_friend_requests_handled_by` (`handled_by_user_id`),
  CONSTRAINT `fk_friend_requests_handled_by` FOREIGN KEY (`handled_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_friend_requests_receiver` FOREIGN KEY (`receiver_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_friend_requests_requester` FOREIGN KEY (`requester_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_friend_requests_source_conversation` FOREIGN KEY (`source_conversation_id`) REFERENCES `chat_conversations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_friend_requests_not_self` CHECK (`requester_user_id` <> `receiver_user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='好友请求表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `user_blocks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_blocks` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` bigint(20) unsigned NOT NULL COMMENT '拉黑方用户ID',
  `blocked_user_id` bigint(20) unsigned NOT NULL COMMENT '被拉黑用户ID',
  `created_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '拉黑时间',
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_user_blocks_user_blocked` (`user_id`,`blocked_user_id`),
  KEY `idx_user_blocks_blocked` (`blocked_user_id`),
  CONSTRAINT `fk_user_blocks_blocked` FOREIGN KEY (`blocked_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_blocks_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户拉黑关系表（按拉黑方方向存储）';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `user_blacklist_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_blacklist_records` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` bigint(20) unsigned NOT NULL COMMENT '被拉黑的用户ID',
  `operator_user_id` bigint(20) unsigned DEFAULT NULL COMMENT '执行操作的管理员用户ID',
  `reason` varchar(255) NOT NULL COMMENT '拉黑或解封原因',
  `status` tinyint(1) NOT NULL COMMENT '状态：1拉黑，0解封（历史记录）',
  `occurred_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '操作发生时间',
  PRIMARY KEY (`id`),
  KEY `idx_blacklist_user` (`user_id`,`occurred_at`),
  KEY `fk_blacklist_operator` (`operator_user_id`),
  CONSTRAINT `fk_blacklist_operator` FOREIGN KEY (`operator_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_blacklist_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户黑名单记录表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `soft_delete_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `soft_delete_logs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `table_name` varchar(64) NOT NULL COMMENT '伪删除记录所属表名',
  `record_id` bigint(20) unsigned NOT NULL COMMENT '被伪删除记录的主键ID',
  `deleter_user_id` bigint(20) unsigned DEFAULT NULL COMMENT '执行伪删除操作的用户ID',
  `reason` varchar(255) DEFAULT NULL COMMENT '伪删除原因',
  `deleted_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '伪删除时间',
  `extra` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '扩展信息(JSON)，如数据快照等' CHECK (json_valid(`extra`)),
  PRIMARY KEY (`id`),
  KEY `idx_soft_delete_table_record` (`table_name`,`record_id`),
  KEY `idx_soft_delete_deleted_at` (`deleted_at`),
  KEY `fk_soft_delete_deleter` (`deleter_user_id`),
  CONSTRAINT `fk_soft_delete_deleter` FOREIGN KEY (`deleter_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='伪删除操作日志表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `user_activity`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_activity` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` bigint(20) unsigned DEFAULT NULL COMMENT '用户ID（匿名操作可为空）',
  `action` varchar(64) NOT NULL COMMENT '操作名称/事件标识',
  `path` varchar(255) NOT NULL COMMENT '页面路径或操作路径',
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '扩展元数据(JSON)，参数等' CHECK (json_valid(`metadata`)),
  `ip` varchar(45) DEFAULT NULL COMMENT 'IP地址',
  `user_agent` varchar(512) DEFAULT NULL COMMENT 'User-Agent信息',
  `created_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '记录时间',
  PRIMARY KEY (`id`),
  KEY `idx_activity_user_created` (`user_id`,`created_at`),
  KEY `idx_activity_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户行为埋点日志表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `user_login_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_login_records` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` bigint(20) unsigned NOT NULL COMMENT '用户ID',
  `session_id` varchar(64) NOT NULL COMMENT '设备会话标识（JWT sid，刷新沿用）',
  `login_type` varchar(32) NOT NULL DEFAULT 'password' COMMENT '登录方式：password/email-code/wechat/register/email-change',
  `platform` varchar(32) NOT NULL DEFAULT 'unknown' COMMENT '客户端平台：mp-weixin/h5/app/unknown',
  `device` varchar(128) NOT NULL DEFAULT '' COMMENT '设备展示名，如 iPhone 13 · 微信',
  `user_agent` varchar(512) DEFAULT NULL COMMENT 'User-Agent（截断后）',
  `ip` varchar(45) DEFAULT NULL COMMENT '登录IP（v4/v6）',
  `location` varchar(64) DEFAULT NULL COMMENT '归一化登录地点：河南 · 郑州 / 境外 / 本地网络 / 未知位置',
  `province` varchar(64) DEFAULT NULL COMMENT '省（仅国内）',
  `city` varchar(64) DEFAULT NULL COMMENT '市（仅国内，可能为空）',
  `district` varchar(64) DEFAULT NULL COMMENT '区县（仅国内，可能为空）',
  `isp` varchar(64) DEFAULT NULL COMMENT '运营商（仅国内，可能为空）',
  `is_domestic` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否中国大陆IP：1是，0否',
  `login_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '登录时间（UTC）',
  `logout_at` datetime DEFAULT NULL COMMENT '退出/被撤销时间（UTC，NULL=未退出）',
  PRIMARY KEY (`id`),
  KEY `idx_login_records_user_time` (`user_id`,`login_at`),
  KEY `idx_login_records_user_domestic_time` (`user_id`,`is_domestic`,`login_at`),
  KEY `idx_login_records_session` (`session_id`),
  CONSTRAINT `fk_login_records_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户登录记录表（含IP归属地）';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `__efmigrationshistory`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `__efmigrationshistory` (
  `MigrationId` varchar(150) NOT NULL,
  `ProductVersion` varchar(32) NOT NULL,
  PRIMARY KEY (`MigrationId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*M!100616 SET NOTE_VERBOSITY=@OLD_NOTE_VERBOSITY */;


SET FOREIGN_KEY_CHECKS = 1;
SET UNIQUE_CHECKS = 1;
-- 结束：2026-11-04_schema_01_user.sql
