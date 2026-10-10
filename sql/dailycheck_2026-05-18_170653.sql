-- MySQL dump 10.13  Distrib 8.0.33, for Win64 (x86_64)
--
-- Host: 8.137.127.7    Database: dailycheck
-- ------------------------------------------------------
-- Server version	8.0.36

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `__efmigrationshistory`
--

DROP TABLE IF EXISTS `__efmigrationshistory`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `__efmigrationshistory` (
  `MigrationId` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `ProductVersion` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  PRIMARY KEY (`MigrationId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `chat_conversation_members`
--

DROP TABLE IF EXISTS `chat_conversation_members`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_conversation_members` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `conversation_id` bigint unsigned NOT NULL COMMENT '会话ID',
  `user_id` bigint unsigned NOT NULL COMMENT '用户ID',
  `member_role` enum('owner','admin','member') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'member' COMMENT '成员角色',
  `membership_status` enum('active','left','kicked') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT '成员状态（active：活跃，left：已离开，kicked：被踢出）',
  `joined_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '加入时间',
  `invited_at` datetime DEFAULT NULL COMMENT '邀请时间',
  `invited_by_user_id` bigint unsigned DEFAULT NULL COMMENT '邀请人用户ID',
  `left_at` datetime DEFAULT NULL COMMENT '离开时间（NULL表示仍在会话中）',
  `removed_by_user_id` bigint unsigned DEFAULT NULL COMMENT '移除操作人用户ID',
  `removed_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '离开或移除原因',
  `mute_until` datetime DEFAULT NULL COMMENT '禁言截至时间（NULL表示不禁言）',
  `mute_mode` enum('temporary','permanent') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '禁言模式（temporary：临时，permanent：永久）',
  `mute_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '禁言原因',
  `muted_at` datetime DEFAULT NULL COMMENT '禁言开始时间',
  `muted_by_user_id` bigint unsigned DEFAULT NULL COMMENT '禁言操作人用户ID',
  `is_pinned` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否置顶会话：1是，0否',
  `is_muted` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否消息免打扰：1是，0否',
  `last_read_message_id` bigint unsigned DEFAULT NULL COMMENT '最后已读消息ID（逻辑引用）',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
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
  CONSTRAINT `fk_chat_members_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_chat_members_invited_by` FOREIGN KEY (`invited_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_chat_members_muted_by` FOREIGN KEY (`muted_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_chat_members_removed_by` FOREIGN KEY (`removed_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_chat_members_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=24 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会话成员关系表（支持邀请、踢出、禁言）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `chat_conversations`
--

DROP TABLE IF EXISTS `chat_conversations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_conversations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '会话ID',
  `conversation_type` enum('direct','group') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'group' COMMENT '会话类型：direct=双人，group=多人/群聊',
  `title` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '会话标题（群聊可配置）',
  `owner_user_id` bigint unsigned DEFAULT NULL COMMENT '群主/创建者用户ID',
  `avatar_key` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '会话头像存储标识',
  `is_active` tinyint(1) NOT NULL DEFAULT '1' COMMENT '会话状态：1=可用，0=已停用',
  `conversation_status` enum('active','disbanded','archived') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT '会话生命周期状态：active=正常活跃,disbanded=已解散,archived=已归档',
  `member_limit` int unsigned NOT NULL DEFAULT '500' COMMENT '群成员人数上限',
  `last_message_at` datetime DEFAULT NULL COMMENT '最后一条消息发送时间',
  `disbanded_at` datetime DEFAULT NULL COMMENT '群解散时间',
  `disbanded_by_user_id` bigint unsigned DEFAULT NULL COMMENT '解散操作人用户ID',
  `disband_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '群解散原因说明',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
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

--
-- Table structure for table `chat_file_records`
--

DROP TABLE IF EXISTS `chat_file_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_file_records` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `file_key` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '文件唯一标识（SHA256哈希或组合键）',
  `conversation_id` bigint unsigned NOT NULL COMMENT '所属会话ID',
  `uploader_user_id` bigint unsigned NOT NULL COMMENT '上传者用户ID',
  `original_filename` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '原始文件名（不含路径）',
  `file_size` bigint unsigned NOT NULL DEFAULT '0' COMMENT '文件实际存储大小（字节）',
  `content_type` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'MIME类型',
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0' COMMENT '软删除标记：0-未删除，1-已删除',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
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

--
-- Table structure for table `chat_group_action_logs`
--

DROP TABLE IF EXISTS `chat_group_action_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_group_action_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `conversation_id` bigint unsigned NOT NULL COMMENT '群聊会话ID',
  `action_type` enum('create','invite','join','kick','mute','unmute','disband','transfer_owner','set_admin','unset_admin','leave') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '群操作类型',
  `operator_user_id` bigint unsigned DEFAULT NULL COMMENT '操作者用户ID',
  `target_user_id` bigint unsigned DEFAULT NULL COMMENT '目标用户ID',
  `related_message_id` bigint unsigned DEFAULT NULL COMMENT '关联系统消息ID',
  `action_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作原因',
  `action_payload` json DEFAULT NULL COMMENT '额外JSON负载数据',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
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

--
-- Table structure for table `chat_group_join_requests`
--

DROP TABLE IF EXISTS `chat_group_join_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_group_join_requests` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `conversation_id` bigint unsigned NOT NULL COMMENT '群聊会话ID',
  `requester_user_id` bigint unsigned NOT NULL COMMENT '申请人用户ID',
  `request_message` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '申请附言',
  `request_status` enum('pending','approved','rejected','expired') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '申请状态：pending=待处理,approved=已通过,rejected=已拒绝,expired=已过期',
  `handled_by_user_id` bigint unsigned DEFAULT NULL COMMENT '处理人用户ID',
  `handled_at` datetime DEFAULT NULL COMMENT '处理时间',
  `reject_reason` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '拒绝原因',
  `expire_at` datetime DEFAULT NULL COMMENT '申请过期时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
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

--
-- Table structure for table `chat_message_receipts`
--

DROP TABLE IF EXISTS `chat_message_receipts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_message_receipts` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `message_id` bigint unsigned NOT NULL COMMENT '消息ID',
  `user_id` bigint unsigned NOT NULL COMMENT '已读用户ID',
  `read_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '已读时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_chat_receipts_message_user` (`message_id`,`user_id`),
  KEY `idx_chat_receipts_user` (`user_id`),
  KEY `idx_chat_receipts_read_at` (`read_at`),
  CONSTRAINT `fk_chat_receipts_message` FOREIGN KEY (`message_id`) REFERENCES `chat_messages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_chat_receipts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=205 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='消息已读回执表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `chat_messages`
--

DROP TABLE IF EXISTS `chat_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_messages` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '消息ID',
  `conversation_id` bigint unsigned NOT NULL COMMENT '会话ID',
  `sender_user_id` bigint unsigned NOT NULL COMMENT '发送者用户ID',
  `message_type` enum('text','image','video','audio','file','system') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'text' COMMENT '消息类型',
  `content` text COLLATE utf8mb4_unicode_ci COMMENT '消息文本内容',
  `extra` json DEFAULT NULL COMMENT '扩展字段(JSON)，如图片/文件信息、@信息等',
  `reply_to_message_id` bigint unsigned DEFAULT NULL COMMENT '引用回复的消息ID',
  `is_recalled` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否撤回：1是，0否',
  `recalled_at` datetime DEFAULT NULL COMMENT '撤回时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发送时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_chat_messages_conversation_time` (`conversation_id`,`created_at`),
  KEY `idx_chat_messages_sender` (`sender_user_id`),
  KEY `idx_chat_messages_reply` (`reply_to_message_id`),
  KEY `idx_chat_messages_conversation_seq` (`conversation_id`,`id`),
  CONSTRAINT `fk_chat_messages_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_chat_messages_reply` FOREIGN KEY (`reply_to_message_id`) REFERENCES `chat_messages` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_chat_messages_sender` FOREIGN KEY (`sender_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=207 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='聊天消息表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `checkin_plan_time_slots`
--

DROP TABLE IF EXISTS `checkin_plan_time_slots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `checkin_plan_time_slots` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `plan_id` bigint unsigned NOT NULL COMMENT '所属打卡计划ID',
  `slot_name` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '时间段名称，如“早晨”、“下午”',
  `start_time` time NOT NULL COMMENT '开始时间（如 09:00:00）',
  `end_time` time NOT NULL COMMENT '结束时间（如 10:00:00）',
  `order_num` smallint unsigned NOT NULL DEFAULT '0' COMMENT '排序序号，用于界面展示顺序',
  `is_active` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否启用：1启用，0停用',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_slots_plan` (`plan_id`),
  KEY `idx_slots_active` (`is_active`),
  CONSTRAINT `fk_slots_plan` FOREIGN KEY (`plan_id`) REFERENCES `checkin_plans` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=28 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='打卡计划时间段配置表（每日重复）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `checkin_plans`
--

DROP TABLE IF EXISTS `checkin_plans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `checkin_plans` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` bigint unsigned NOT NULL COMMENT '计划所属用户ID',
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '打卡计划标题',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '打卡计划描述',
  `start_date` date NOT NULL COMMENT '计划开始日期',
  `end_date` date DEFAULT NULL COMMENT '计划结束日期（可选）',
  `is_active` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否启用：1启用，0停用',
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否伪删除：0正常，1已删除',
  `deleted_at` datetime DEFAULT NULL COMMENT '伪删除时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `checkin_mode` tinyint unsigned NOT NULL DEFAULT '0' COMMENT '打卡模式：0-默认模式，1-时间段打卡模式',
  PRIMARY KEY (`id`),
  KEY `idx_plans_user` (`user_id`),
  KEY `idx_plans_start_date` (`start_date`),
  KEY `idx_plans_is_active` (`is_active`),
  KEY `idx_plans_is_deleted` (`is_deleted`),
  CONSTRAINT `fk_plans_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=43 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='打卡计划表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `checkins`
--

DROP TABLE IF EXISTS `checkins`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `checkins` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `plan_id` bigint unsigned NOT NULL COMMENT '所属打卡计划ID',
  `time_slot_id` bigint unsigned DEFAULT NULL COMMENT '关联的打卡时间段ID',
  `user_id` bigint unsigned NOT NULL COMMENT '打卡用户ID',
  `check_date` date NOT NULL COMMENT '打卡日期（仅日期）',
  `images` json DEFAULT NULL COMMENT '打卡图片URL数组(JSON)',
  `note` text COLLATE utf8mb4_unicode_ci COMMENT '打卡备注',
  `status` tinyint NOT NULL COMMENT '打卡状态：0错过(红)、1成功(绿)、2补签(黄)',
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否伪删除：0正常，1已删除',
  `deleted_at` datetime DEFAULT NULL COMMENT '伪删除时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_checkins_plan_date_slot` (`plan_id`,`check_date`,`time_slot_id`),
  KEY `idx_checkins_user_date` (`user_id`,`check_date`),
  KEY `idx_checkins_status` (`status`),
  KEY `idx_checkins_is_deleted` (`is_deleted`),
  KEY `fk_checkins_time_slot` (`time_slot_id`),
  CONSTRAINT `fk_checkins_plan` FOREIGN KEY (`plan_id`) REFERENCES `checkin_plans` (`id`),
  CONSTRAINT `fk_checkins_time_slot` FOREIGN KEY (`time_slot_id`) REFERENCES `checkin_plan_time_slots` (`id`),
  CONSTRAINT `fk_checkins_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=165 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='打卡记录表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `soft_delete_logs`
--

DROP TABLE IF EXISTS `soft_delete_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `soft_delete_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `table_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '伪删除记录所属表名',
  `record_id` bigint unsigned NOT NULL COMMENT '被伪删除记录的主键ID',
  `deleter_user_id` bigint unsigned DEFAULT NULL COMMENT '执行伪删除操作的用户ID',
  `reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '伪删除原因',
  `deleted_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '伪删除时间',
  `extra` json DEFAULT NULL COMMENT '扩展信息(JSON)，如数据快照等',
  PRIMARY KEY (`id`),
  KEY `idx_soft_delete_table_record` (`table_name`,`record_id`),
  KEY `idx_soft_delete_deleted_at` (`deleted_at`),
  KEY `fk_soft_delete_deleter` (`deleter_user_id`),
  CONSTRAINT `fk_soft_delete_deleter` FOREIGN KEY (`deleter_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='伪删除操作日志表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_activity`
--

DROP TABLE IF EXISTS `user_activity`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_activity` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` bigint unsigned DEFAULT NULL COMMENT '用户ID（匿名操作可为空）',
  `action` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作名称/事件标识',
  `path` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '页面路径或操作路径',
  `metadata` json DEFAULT NULL COMMENT '扩展元数据(JSON)，参数等',
  `ip` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'IP地址',
  `user_agent` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'User-Agent信息',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
  PRIMARY KEY (`id`),
  KEY `idx_activity_user_created` (`user_id`,`created_at`),
  KEY `idx_activity_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户行为埋点日志表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_blacklist_records`
--

DROP TABLE IF EXISTS `user_blacklist_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_blacklist_records` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` bigint unsigned NOT NULL COMMENT '被拉黑的用户ID',
  `operator_user_id` bigint unsigned DEFAULT NULL COMMENT '执行操作的管理员用户ID',
  `reason` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '拉黑或解封原因',
  `status` tinyint(1) NOT NULL COMMENT '状态：1拉黑，0解封（历史记录）',
  `occurred_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作发生时间',
  PRIMARY KEY (`id`),
  KEY `idx_blacklist_user` (`user_id`,`occurred_at`),
  KEY `fk_blacklist_operator` (`operator_user_id`),
  CONSTRAINT `fk_blacklist_operator` FOREIGN KEY (`operator_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_blacklist_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户黑名单记录表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_friend_requests`
--

DROP TABLE IF EXISTS `user_friend_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_friend_requests` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `requester_user_id` bigint unsigned NOT NULL COMMENT '请求者用户ID',
  `receiver_user_id` bigint unsigned NOT NULL COMMENT '接收者用户ID',
  `source_conversation_id` bigint unsigned DEFAULT NULL COMMENT '来源群组会话ID',
  `request_message` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '请求消息',
  `request_source` enum('account','group','search','system') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'account' COMMENT '请求来源（account-账号/group-群组/search-搜索/system-系统）',
  `request_status` enum('pending','accepted','rejected','cancelled','expired') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '请求状态（pending-待处理/accepted-已接受/rejected-已拒绝/cancelled-已取消/expired-已过期）',
  `handled_by_user_id` bigint unsigned DEFAULT NULL COMMENT '处理者用户ID',
  `handled_at` datetime DEFAULT NULL COMMENT '处理时间',
  `reject_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '拒绝原因',
  `expire_at` datetime DEFAULT NULL COMMENT '过期时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
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
  CONSTRAINT `chk_friend_requests_not_self` CHECK ((`requester_user_id` <> `receiver_user_id`))
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='好友请求表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_friendships`
--

DROP TABLE IF EXISTS `user_friendships`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_friendships` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id` bigint unsigned NOT NULL COMMENT '用户ID',
  `friend_user_id` bigint unsigned NOT NULL COMMENT '好友用户ID',
  `source_request_id` bigint unsigned DEFAULT NULL COMMENT '来源好友请求ID',
  `source_conversation_id` bigint unsigned DEFAULT NULL COMMENT '来源群组会话ID',
  `status` enum('active','deleted') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT '好友关系状态（active-活跃/deleted-已删除）',
  `friend_remark` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '好友备注',
  `is_starred` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否置顶（0-否/1-是）',
  `is_muted` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否静音（0-否/1-是）',
  `accepted_at` datetime DEFAULT NULL COMMENT '接受时间',
  `created_by_user_id` bigint unsigned DEFAULT NULL COMMENT '创建关系的操作者用户ID',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  `deleted_by_user_id` bigint unsigned DEFAULT NULL COMMENT '删除关系的操作者用户ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_friendships_user_friend` (`user_id`,`friend_user_id`),
  KEY `idx_friendships_user_status` (`user_id`,`status`),
  KEY `idx_friendships_friend_status` (`friend_user_id`,`status`),
  KEY `idx_friendships_source_request` (`source_request_id`),
  KEY `idx_friendships_source_conversation` (`source_conversation_id`),
  KEY `idx_friendships_created_by` (`created_by_user_id`),
  KEY `idx_friendships_deleted_by` (`deleted_by_user_id`),
  CONSTRAINT `fk_friendships_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_friendships_deleted_by` FOREIGN KEY (`deleted_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_friendships_friend` FOREIGN KEY (`friend_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_friendships_source_conversation` FOREIGN KEY (`source_conversation_id`) REFERENCES `chat_conversations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_friendships_source_request` FOREIGN KEY (`source_request_id`) REFERENCES `user_friend_requests` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_friendships_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_friendships_not_self` CHECK ((`user_id` <> `friend_user_id`))
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='好友关系表（按用户方向存储）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_oauth_accounts`
--

DROP TABLE IF EXISTS `user_oauth_accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_oauth_accounts` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` bigint unsigned NOT NULL COMMENT '关联用户ID',
  `provider` enum('wechat','google','apple') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '第三方登录平台类型',
  `open_id` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '第三方平台open_id',
  `union_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '第三方平台union_id（可选）',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '绑定时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_oauth_provider_open` (`provider`,`open_id`),
  UNIQUE KEY `ux_oauth_provider_union` (`provider`,`union_id`),
  KEY `idx_oauth_user` (`user_id`),
  KEY `idx_oauth_union_id` (`union_id`),
  CONSTRAINT `fk_oauth_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户第三方登录账号绑定表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '用户邮箱（唯一）',
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '密码哈希（如bcrypt）',
  `nick_name` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '用户昵称',
  `avatar_key` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '头像图片URL',
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否伪删除：0正常，1已删除',
  `deleted_at` datetime DEFAULT NULL COMMENT '伪删除时间',
  `status` tinyint(1) NOT NULL DEFAULT '1' COMMENT '账户状态：1正常，0冻结',
  `role` enum('user','admin') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user' COMMENT '用户角色：user普通用户，admin管理员',
  `frozen_at` datetime DEFAULT NULL COMMENT '账户冻结时间',
  `frozen_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '账户冻结原因',
  `freeze_operator_id` bigint unsigned DEFAULT NULL COMMENT '执行冻结操作的管理员用户ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `user_account` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户账号（唯一）',
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

--
-- Dumping routines for database 'dailycheck'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-18 17:07:09
