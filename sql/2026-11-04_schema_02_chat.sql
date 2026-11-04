-- ============================================================
-- 聊天与群聊（仅结构（不含数据））
-- 目标库：dailycheck（MySQL 8 / MariaDB 10.4+，utf8mb4）
-- 生成时间：2026-11-04 13:12:24 +0000
-- 内容：会话、成员、消息、回执、伪删除、文件记录、群申请与操作日志
--
-- 【不含数据】可直接入库、分发给他人部署；真实数据备份见 sql/private/。
--
-- 表清单：
--   chat_conversations
--   chat_conversation_members
--   chat_messages
--   chat_message_receipts
--   chat_message_deletions
--   chat_file_records
--   chat_group_join_requests
--   chat_group_action_logs
--
-- 恢复顺序：01_user → 02_chat → 03_checkin
--   mysql -h127.0.0.1 -uroot -p < 2026-11-04_schema_02_chat.sql
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
DROP TABLE IF EXISTS `chat_conversations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_conversations` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '会话ID',
  `conversation_type` enum('direct','group') NOT NULL DEFAULT 'group' COMMENT '会话类型：direct=双人，group=多人/群聊',
  `title` varchar(128) DEFAULT NULL COMMENT '会话标题（群聊可配置）',
  `owner_user_id` bigint(20) unsigned DEFAULT NULL COMMENT '群主/创建者用户ID',
  `avatar_key` varchar(512) DEFAULT NULL COMMENT '会话头像存储标识',
  `is_active` tinyint(1) NOT NULL DEFAULT 1 COMMENT '会话状态：1=可用，0=已停用',
  `conversation_status` enum('active','disbanded','archived') NOT NULL DEFAULT 'active' COMMENT '会话生命周期状态：active=正常活跃,disbanded=已解散,archived=已归档',
  `member_limit` int(10) unsigned NOT NULL DEFAULT 500 COMMENT '群成员人数上限',
  `last_message_at` datetime DEFAULT NULL COMMENT '最后一条消息发送时间',
  `disbanded_at` datetime DEFAULT NULL COMMENT '群解散时间',
  `disbanded_by_user_id` bigint(20) unsigned DEFAULT NULL COMMENT '解散操作人用户ID',
  `disband_reason` varchar(255) DEFAULT NULL COMMENT '群解散原因说明',
  `created_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_chat_conversations_owner` (`owner_user_id`),
  KEY `idx_chat_conversations_type` (`conversation_type`),
  KEY `idx_chat_conversations_active` (`is_active`),
  KEY `idx_chat_conversations_status` (`conversation_status`),
  KEY `idx_chat_conversations_last_message_at` (`last_message_at`),
  KEY `idx_chat_conversations_disbanded_by` (`disbanded_by_user_id`),
  CONSTRAINT `fk_chat_conversations_disbanded_by` FOREIGN KEY (`disbanded_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_chat_conversations_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='聊天会话主表（支持群管理扩展）';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `chat_conversation_members`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_conversation_members` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `conversation_id` bigint(20) unsigned NOT NULL COMMENT '会话ID',
  `user_id` bigint(20) unsigned NOT NULL COMMENT '用户ID',
  `member_role` enum('owner','admin','member') NOT NULL DEFAULT 'member' COMMENT '成员角色',
  `membership_status` enum('active','left','kicked') NOT NULL DEFAULT 'active' COMMENT '成员状态（active：活跃，left：已离开，kicked：被踢出）',
  `joined_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '加入时间',
  `invited_at` datetime DEFAULT NULL COMMENT '邀请时间',
  `invited_by_user_id` bigint(20) unsigned DEFAULT NULL COMMENT '邀请人用户ID',
  `left_at` datetime DEFAULT NULL COMMENT '离开时间（NULL表示仍在会话中）',
  `removed_by_user_id` bigint(20) unsigned DEFAULT NULL COMMENT '移除操作人用户ID',
  `removed_reason` varchar(255) DEFAULT NULL COMMENT '离开或移除原因',
  `mute_until` datetime DEFAULT NULL COMMENT '禁言截至时间（NULL表示不禁言）',
  `mute_mode` enum('temporary','permanent') DEFAULT NULL COMMENT '禁言模式（temporary：临时，permanent：永久）',
  `mute_reason` varchar(255) DEFAULT NULL COMMENT '禁言原因',
  `muted_at` datetime DEFAULT NULL COMMENT '禁言开始时间',
  `muted_by_user_id` bigint(20) unsigned DEFAULT NULL COMMENT '禁言操作人用户ID',
  `is_pinned` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否置顶会话：1是，0否',
  `is_muted` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否消息免打扰：1是，0否',
  `is_hidden` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否对该用户隐藏会话（伪删除标记）',
  `history_cleared_before_message_id` bigint(20) unsigned DEFAULT NULL COMMENT '聊天记录清除到此消息ID（含），仅对该用户生效',
  `history_cleared_at` datetime DEFAULT NULL COMMENT '聊天记录清除时间（仅该用户）',
  `last_read_message_id` bigint(20) unsigned DEFAULT NULL COMMENT '最后已读消息ID（逻辑引用）',
  `created_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_chat_members_conversation_user` (`conversation_id`,`user_id`),
  KEY `idx_chat_members_user` (`user_id`),
  KEY `idx_chat_members_conversation` (`conversation_id`),
  KEY `idx_chat_members_status` (`membership_status`),
  KEY `idx_chat_members_conversation_active` (`conversation_id`,`left_at`),
  KEY `idx_chat_members_user_active` (`user_id`,`left_at`),
  KEY `idx_chat_members_invited_by` (`invited_by_user_id`),
  KEY `idx_chat_members_removed_by` (`removed_by_user_id`),
  KEY `idx_chat_members_muted_by` (`muted_by_user_id`),
  KEY `idx_chat_members_user_left_conversation` (`user_id`,`left_at`,`conversation_id`,`is_pinned`,`updated_at`),
  KEY `idx_chat_members_conversation_left_joined` (`conversation_id`,`left_at`,`joined_at`),
  CONSTRAINT `fk_chat_members_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_chat_members_invited_by` FOREIGN KEY (`invited_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_chat_members_muted_by` FOREIGN KEY (`muted_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_chat_members_removed_by` FOREIGN KEY (`removed_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_chat_members_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=24 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会话成员关系表（支持邀请、踢出、禁言）';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `chat_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_messages` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '消息ID',
  `conversation_id` bigint(20) unsigned NOT NULL COMMENT '会话ID',
  `sender_user_id` bigint(20) unsigned NOT NULL COMMENT '发送者用户ID',
  `message_type` enum('text','image','video','audio','file','system') NOT NULL DEFAULT 'text' COMMENT '消息类型',
  `content` text DEFAULT NULL COMMENT '消息文本内容',
  `extra` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '扩展字段(JSON)，如图片/文件信息、@信息等' CHECK (json_valid(`extra`)),
  `reply_to_message_id` bigint(20) unsigned DEFAULT NULL COMMENT '引用回复的消息ID',
  `is_recalled` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否撤回：1是，0否',
  `recalled_at` datetime DEFAULT NULL COMMENT '撤回时间',
  `recalled_by_user_id` bigint(20) unsigned DEFAULT NULL COMMENT '执行撤回的用户ID',
  `recall_prompt` varchar(255) DEFAULT NULL COMMENT '管理撤回提示（在原消息位置展示）',
  `created_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '发送时间',
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_chat_messages_conversation_time` (`conversation_id`,`created_at`),
  KEY `idx_chat_messages_sender` (`sender_user_id`),
  KEY `idx_chat_messages_reply` (`reply_to_message_id`),
  KEY `idx_chat_messages_conversation_seq` (`conversation_id`,`id`),
  KEY `idx_chat_messages_recalled_by` (`recalled_by_user_id`),
  CONSTRAINT `fk_chat_messages_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_chat_messages_recalled_by` FOREIGN KEY (`recalled_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_chat_messages_reply` FOREIGN KEY (`reply_to_message_id`) REFERENCES `chat_messages` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_chat_messages_sender` FOREIGN KEY (`sender_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=207 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='聊天消息表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `chat_message_receipts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_message_receipts` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `message_id` bigint(20) unsigned NOT NULL COMMENT '消息ID',
  `user_id` bigint(20) unsigned NOT NULL COMMENT '已读用户ID',
  `read_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '已读时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_chat_receipts_message_user` (`message_id`,`user_id`),
  KEY `idx_chat_receipts_user` (`user_id`),
  KEY `idx_chat_receipts_read_at` (`read_at`),
  CONSTRAINT `fk_chat_receipts_message` FOREIGN KEY (`message_id`) REFERENCES `chat_messages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_chat_receipts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=205 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='消息已读回执表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `chat_message_deletions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_message_deletions` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `message_id` bigint(20) unsigned NOT NULL COMMENT '被隐藏的消息ID',
  `user_id` bigint(20) unsigned NOT NULL COMMENT '执行隐藏的用户ID（仅该用户不可见）',
  `reason` varchar(255) DEFAULT NULL COMMENT '删除原因说明',
  `deleted_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '删除（隐藏）时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_chat_message_deletions_message_user` (`message_id`,`user_id`),
  KEY `idx_chat_message_deletions_user` (`user_id`),
  CONSTRAINT `fk_chat_message_deletions_message` FOREIGN KEY (`message_id`) REFERENCES `chat_messages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_chat_message_deletions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='聊天消息按用户伪删除标记表（仅删除者不可见）';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `chat_file_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_file_records` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `file_key` varchar(128) NOT NULL COMMENT '文件唯一标识（SHA256哈希或组合键）',
  `conversation_id` bigint(20) unsigned NOT NULL COMMENT '所属会话ID',
  `uploader_user_id` bigint(20) unsigned NOT NULL COMMENT '上传者用户ID',
  `original_filename` varchar(255) DEFAULT NULL COMMENT '原始文件名（不含路径）',
  `file_size` bigint(20) unsigned NOT NULL DEFAULT 0 COMMENT '文件实际存储大小（字节）',
  `content_type` varchar(255) NOT NULL COMMENT 'MIME类型',
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0 COMMENT '软删除标记：0-未删除，1-已删除',
  `created_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_chat_file_records_file_key` (`file_key`),
  KEY `idx_chat_file_records_conversation` (`conversation_id`),
  KEY `idx_chat_file_records_uploader` (`uploader_user_id`),
  KEY `idx_chat_file_records_deleted` (`is_deleted`),
  KEY `idx_chat_file_records_created` (`created_at`),
  CONSTRAINT `fk_chat_file_records_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_chat_file_records_uploader` FOREIGN KEY (`uploader_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=60 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='聊天文件元数据记录表，用于权限验证与文件追溯';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `chat_group_join_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_group_join_requests` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `conversation_id` bigint(20) unsigned NOT NULL COMMENT '群聊会话ID',
  `requester_user_id` bigint(20) unsigned NOT NULL COMMENT '申请人用户ID',
  `request_message` varchar(255) DEFAULT NULL COMMENT '申请附言',
  `request_status` enum('pending','approved','rejected','expired') NOT NULL DEFAULT 'pending' COMMENT '申请状态：pending=待处理,approved=已通过,rejected=已拒绝,expired=已过期',
  `handled_by_user_id` bigint(20) unsigned DEFAULT NULL COMMENT '处理人用户ID',
  `handled_at` datetime DEFAULT NULL COMMENT '处理时间',
  `reject_reason` varchar(255) DEFAULT NULL COMMENT '拒绝原因',
  `expire_at` datetime DEFAULT NULL COMMENT '申请过期时间',
  `created_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_group_join_requests_conversation_status` (`conversation_id`,`request_status`,`created_at`),
  KEY `idx_group_join_requests_requester_status` (`requester_user_id`,`request_status`,`created_at`),
  KEY `idx_group_join_requests_pair_status` (`conversation_id`,`requester_user_id`,`request_status`),
  KEY `idx_group_join_requests_status_expire` (`request_status`,`expire_at`),
  KEY `idx_group_join_requests_handled_by` (`handled_by_user_id`),
  CONSTRAINT `fk_group_join_requests_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_group_join_requests_handled_by` FOREIGN KEY (`handled_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_group_join_requests_requester` FOREIGN KEY (`requester_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='群聊加群申请记录表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `chat_group_action_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_group_action_logs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `conversation_id` bigint(20) unsigned NOT NULL COMMENT '群聊会话ID',
  `action_type` enum('create','invite','join','kick','mute','unmute','disband','transfer_owner','set_admin','unset_admin','leave') NOT NULL COMMENT '群操作类型',
  `operator_user_id` bigint(20) unsigned DEFAULT NULL COMMENT '操作者用户ID',
  `target_user_id` bigint(20) unsigned DEFAULT NULL COMMENT '目标用户ID',
  `related_message_id` bigint(20) unsigned DEFAULT NULL COMMENT '关联系统消息ID',
  `action_reason` varchar(255) DEFAULT NULL COMMENT '操作原因',
  `action_payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '额外JSON负载数据' CHECK (json_valid(`action_payload`)),
  `created_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_chat_group_logs_conversation_created` (`conversation_id`,`created_at`),
  KEY `idx_chat_group_logs_action_type` (`action_type`),
  KEY `idx_chat_group_logs_operator` (`operator_user_id`),
  KEY `idx_chat_group_logs_target` (`target_user_id`),
  KEY `idx_chat_group_logs_message` (`related_message_id`),
  CONSTRAINT `fk_chat_group_logs_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_chat_group_logs_message` FOREIGN KEY (`related_message_id`) REFERENCES `chat_messages` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_chat_group_logs_operator` FOREIGN KEY (`operator_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_chat_group_logs_target` FOREIGN KEY (`target_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='群操作日志表';
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
-- 结束：2026-11-04_schema_02_chat.sql
