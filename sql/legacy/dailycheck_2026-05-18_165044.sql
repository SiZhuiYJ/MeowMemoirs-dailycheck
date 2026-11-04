-- Active: 1779101843716@@127.0.0.1@3306@dailycheck
-- MySQL dump 10.13  Distrib 8.0.33, for Win64 (x86_64)
--
-- Host: 8.137.127.7    Database: dailycheck
-- ------------------------------------------------------
-- Server version	8.0.36

-- 检查数据库'dailycheck' 是否存在 ? 跳过创建数据库 : 创建数据库
CREATE DATABASE IF NOT EXISTS `dailycheck` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

USE dailycheck;
/*!80016 DEFAULT ENCRYPTION='N' */
;
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */
;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */
;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */
;
/*!50503 SET NAMES utf8mb4 */
;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */
;
/*!40103 SET TIME_ZONE='+00:00' */
;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */
;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */
;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */
;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */
;

--
-- Table structure for table `__efmigrationshistory`
--

DROP TABLE IF EXISTS `__efmigrationshistory`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
CREATE TABLE `__efmigrationshistory` (
    `MigrationId` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
    `ProductVersion` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
    PRIMARY KEY (`MigrationId`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */
;

--
-- Dumping data for table `__efmigrationshistory`
--

/*!40000 ALTER TABLE `__efmigrationshistory` DISABLE KEYS */
;
/*!40000 ALTER TABLE `__efmigrationshistory` ENABLE KEYS */
;

--
-- Table structure for table `chat_conversation_members`
--

DROP TABLE IF EXISTS `chat_conversation_members`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
CREATE TABLE `chat_conversation_members` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    `conversation_id` bigint unsigned NOT NULL COMMENT '会话ID',
    `user_id` bigint unsigned NOT NULL COMMENT '用户ID',
    `member_role` enum('owner', 'admin', 'member') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'member' COMMENT '成员角色',
    `membership_status` enum('active', 'left', 'kicked') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT '成员状态（active：活跃，left：已离开，kicked：被踢出）',
    `joined_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '加入时间',
    `invited_at` datetime DEFAULT NULL COMMENT '邀请时间',
    `invited_by_user_id` bigint unsigned DEFAULT NULL COMMENT '邀请人用户ID',
    `left_at` datetime DEFAULT NULL COMMENT '离开时间（NULL表示仍在会话中）',
    `removed_by_user_id` bigint unsigned DEFAULT NULL COMMENT '移除操作人用户ID',
    `removed_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '离开或移除原因',
    `mute_until` datetime DEFAULT NULL COMMENT '禁言截至时间（NULL表示不禁言）',
    `mute_mode` enum('temporary', 'permanent') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '禁言模式（temporary：临时，permanent：永久）',
    `mute_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '禁言原因',
    `muted_at` datetime DEFAULT NULL COMMENT '禁言开始时间',
    `muted_by_user_id` bigint unsigned DEFAULT NULL COMMENT '禁言操作人用户ID',
    `is_pinned` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否置顶会话：1是，0否',
    `is_muted` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否消息免打扰：1是，0否',
    `last_read_message_id` bigint unsigned DEFAULT NULL COMMENT '最后已读消息ID（逻辑引用）',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `ux_chat_members_conversation_user` (`conversation_id`, `user_id`),
    KEY `idx_chat_members_user` (`user_id`),
    KEY `idx_chat_members_conversation` (`conversation_id`),
    KEY `idx_chat_members_status` (`membership_status`),
    KEY `idx_chat_members_conversation_active` (`conversation_id`, `left_at`),
    KEY `idx_chat_members_user_active` (`user_id`, `left_at`),
    KEY `idx_chat_members_invited_by` (`invited_by_user_id`),
    KEY `idx_chat_members_removed_by` (`removed_by_user_id`),
    KEY `idx_chat_members_muted_by` (`muted_by_user_id`),
    CONSTRAINT `fk_chat_members_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_chat_members_invited_by` FOREIGN KEY (`invited_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_chat_members_muted_by` FOREIGN KEY (`muted_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_chat_members_removed_by` FOREIGN KEY (`removed_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_chat_members_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB AUTO_INCREMENT = 24 DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '会话成员关系表（支持邀请、踢出、禁言）';
/*!40101 SET character_set_client = @saved_cs_client */
;

--
-- Dumping data for table `chat_conversation_members`
--

/*!40000 ALTER TABLE `chat_conversation_members` DISABLE KEYS */
;
INSERT INTO
    `chat_conversation_members`
VALUES (
        15,
        7,
        8,
        'member',
        'active',
        '2026-04-21 15:21:32',
        '2026-04-21 15:21:32',
        11,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        0,
        0,
        205,
        '2026-04-21 15:21:32',
        '2026-04-24 09:34:46'
    ),
    (
        16,
        7,
        11,
        'member',
        'active',
        '2026-04-21 15:21:32',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        0,
        0,
        205,
        '2026-04-21 15:21:32',
        '2026-04-24 09:34:49'
    ),
    (
        17,
        8,
        14,
        'member',
        'active',
        '2026-04-21 15:54:43',
        '2026-04-21 15:54:43',
        8,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        1,
        1,
        NULL,
        '2026-04-21 15:54:43',
        '2026-04-29 21:54:49'
    ),
    (
        18,
        8,
        8,
        'member',
        'active',
        '2026-04-21 15:54:43',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        0,
        0,
        NULL,
        '2026-04-21 15:54:43',
        '2026-04-21 23:54:44'
    ),
    (
        19,
        9,
        14,
        'member',
        'active',
        '2026-04-21 15:56:31',
        '2026-04-21 15:56:31',
        11,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        0,
        0,
        NULL,
        '2026-04-21 15:56:31',
        '2026-04-21 23:56:31'
    ),
    (
        20,
        9,
        11,
        'member',
        'active',
        '2026-04-21 15:56:31',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        0,
        0,
        NULL,
        '2026-04-21 15:56:31',
        '2026-04-21 23:56:31'
    ),
    (
        21,
        10,
        14,
        'member',
        'active',
        '2026-04-22 11:50:48',
        '2026-04-22 11:50:48',
        8,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        0,
        0,
        NULL,
        '2026-04-22 11:50:48',
        '2026-04-22 22:57:54'
    ),
    (
        22,
        10,
        11,
        'member',
        'active',
        '2026-04-22 16:03:11',
        '2026-04-22 16:03:11',
        8,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        0,
        0,
        206,
        '2026-04-22 11:50:48',
        '2026-04-24 23:21:55'
    ),
    (
        23,
        10,
        8,
        'owner',
        'active',
        '2026-04-22 11:50:48',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        0,
        0,
        206,
        '2026-04-22 11:50:48',
        '2026-04-24 13:16:08'
    );
/*!40000 ALTER TABLE `chat_conversation_members` ENABLE KEYS */
;

--
-- Table structure for table `chat_conversations`
--

DROP TABLE IF EXISTS `chat_conversations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
CREATE TABLE `chat_conversations` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '会话ID',
    `conversation_type` enum('direct', 'group') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'group' COMMENT '会话类型：direct=双人，group=多人/群聊',
    `title` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '会话标题（群聊可配置）',
    `owner_user_id` bigint unsigned DEFAULT NULL COMMENT '群主/创建者用户ID',
    `avatar_key` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '会话头像存储标识',
    `is_active` tinyint(1) NOT NULL DEFAULT '1' COMMENT '会话状态：1=可用，0=已停用',
    `conversation_status` enum(
        'active',
        'disbanded',
        'archived'
    ) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT '会话生命周期状态：active=正常活跃,disbanded=已解散,archived=已归档',
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
) ENGINE = InnoDB AUTO_INCREMENT = 11 DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '聊天会话主表（支持群管理扩展）';
/*!40101 SET character_set_client = @saved_cs_client */
;

--
-- Dumping data for table `chat_conversations`
--

/*!40000 ALTER TABLE `chat_conversations` DISABLE KEYS */
;
INSERT INTO
    `chat_conversations`
VALUES (
        7,
        'direct',
        NULL,
        NULL,
        NULL,
        1,
        'active',
        500,
        '2026-04-24 01:34:46',
        NULL,
        NULL,
        NULL,
        '2026-04-21 15:21:32',
        '2026-04-24 09:34:46'
    ),
    (
        8,
        'direct',
        '茶茶你怎么了',
        NULL,
        '56ef0ab22a368afc0cffcf322bf7ad3d55e898dd31dd9c5e62c206ea1d2ab396',
        1,
        'active',
        500,
        NULL,
        NULL,
        NULL,
        NULL,
        '2026-04-21 15:54:43',
        '2026-04-29 21:51:32'
    ),
    (
        9,
        'direct',
        NULL,
        NULL,
        NULL,
        1,
        'active',
        500,
        NULL,
        NULL,
        NULL,
        NULL,
        '2026-04-21 15:56:31',
        '2026-04-21 23:56:31'
    ),
    (
        10,
        'group',
        '妙妙屋',
        8,
        '047bd3b183d37d76d2adc7312de04969f00051d3265c0329244df1817feec922',
        1,
        'active',
        500,
        '2026-04-24 05:16:08',
        NULL,
        NULL,
        NULL,
        '2026-04-22 11:50:48',
        '2026-04-24 13:16:08'
    );
/*!40000 ALTER TABLE `chat_conversations` ENABLE KEYS */
;

--
-- Table structure for table `chat_file_records`
--

DROP TABLE IF EXISTS `chat_file_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
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
) ENGINE = InnoDB AUTO_INCREMENT = 60 DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '聊天文件元数据记录表，用于权限验证与文件追溯';
/*!40101 SET character_set_client = @saved_cs_client */
;

--
-- Dumping data for table `chat_file_records`
--

/*!40000 ALTER TABLE `chat_file_records` DISABLE KEYS */
;
INSERT INTO
    `chat_file_records`
VALUES (
        59,
        '5a9a7e91244ab22212bc662f54656c17cb5e96b9877e72654e2e50d183271f7e_69eafc98.mp3',
        10,
        8,
        NULL,
        3158570,
        'audio/mpeg',
        0,
        '2026-04-24 05:16:08',
        '2026-04-24 13:16:08'
    );
/*!40000 ALTER TABLE `chat_file_records` ENABLE KEYS */
;

--
-- Table structure for table `chat_group_action_logs`
--

DROP TABLE IF EXISTS `chat_group_action_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
CREATE TABLE `chat_group_action_logs` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    `conversation_id` bigint unsigned NOT NULL COMMENT '群聊会话ID',
    `action_type` enum(
        'create',
        'invite',
        'join',
        'kick',
        'mute',
        'unmute',
        'disband',
        'transfer_owner',
        'set_admin',
        'unset_admin',
        'leave'
    ) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '群操作类型',
    `operator_user_id` bigint unsigned DEFAULT NULL COMMENT '操作者用户ID',
    `target_user_id` bigint unsigned DEFAULT NULL COMMENT '目标用户ID',
    `related_message_id` bigint unsigned DEFAULT NULL COMMENT '关联系统消息ID',
    `action_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作原因',
    `action_payload` json DEFAULT NULL COMMENT '额外JSON负载数据',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (`id`),
    KEY `idx_chat_group_logs_conversation_created` (
        `conversation_id`,
        `created_at`
    ),
    KEY `idx_chat_group_logs_action_type` (`action_type`),
    KEY `idx_chat_group_logs_operator` (`operator_user_id`),
    KEY `idx_chat_group_logs_target` (`target_user_id`),
    KEY `idx_chat_group_logs_message` (`related_message_id`),
    CONSTRAINT `fk_chat_group_logs_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_chat_group_logs_message` FOREIGN KEY (`related_message_id`) REFERENCES `chat_messages` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_chat_group_logs_operator` FOREIGN KEY (`operator_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_chat_group_logs_target` FOREIGN KEY (`target_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE = InnoDB AUTO_INCREMENT = 10 DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '群操作日志表';
/*!40101 SET character_set_client = @saved_cs_client */
;

--
-- Dumping data for table `chat_group_action_logs`
--

/*!40000 ALTER TABLE `chat_group_action_logs` DISABLE KEYS */
;
INSERT INTO
    `chat_group_action_logs`
VALUES (
        6,
        10,
        'kick',
        8,
        11,
        198,
        NULL,
        '{\"targetRole\": \"member\"}',
        '2026-04-22 14:57:59'
    ),
    (
        7,
        10,
        'invite',
        8,
        11,
        NULL,
        NULL,
        '{\"invitedByUserId\": 8}',
        '2026-04-22 14:58:13'
    ),
    (
        8,
        10,
        'kick',
        8,
        11,
        200,
        NULL,
        '{\"targetRole\": \"member\"}',
        '2026-04-22 16:00:39'
    ),
    (
        9,
        10,
        'join',
        8,
        11,
        201,
        NULL,
        '{\"source\": \"join_request\", \"requestId\": 1}',
        '2026-04-22 16:03:11'
    );
/*!40000 ALTER TABLE `chat_group_action_logs` ENABLE KEYS */
;

--
-- Table structure for table `chat_group_join_requests`
--

DROP TABLE IF EXISTS `chat_group_join_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
CREATE TABLE `chat_group_join_requests` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    `conversation_id` bigint unsigned NOT NULL COMMENT '群聊会话ID',
    `requester_user_id` bigint unsigned NOT NULL COMMENT '申请人用户ID',
    `request_message` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '申请附言',
    `request_status` enum(
        'pending',
        'approved',
        'rejected',
        'expired'
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '申请状态：pending=待处理,approved=已通过,rejected=已拒绝,expired=已过期',
    `handled_by_user_id` bigint unsigned DEFAULT NULL COMMENT '处理人用户ID',
    `handled_at` datetime DEFAULT NULL COMMENT '处理时间',
    `reject_reason` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '拒绝原因',
    `expire_at` datetime DEFAULT NULL COMMENT '申请过期时间',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    KEY `idx_group_join_requests_conversation_status` (
        `conversation_id`,
        `request_status`,
        `created_at`
    ),
    KEY `idx_group_join_requests_requester_status` (
        `requester_user_id`,
        `request_status`,
        `created_at`
    ),
    KEY `idx_group_join_requests_pair_status` (
        `conversation_id`,
        `requester_user_id`,
        `request_status`
    ),
    KEY `idx_group_join_requests_status_expire` (`request_status`, `expire_at`),
    KEY `idx_group_join_requests_handled_by` (`handled_by_user_id`),
    CONSTRAINT `fk_group_join_requests_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_group_join_requests_handled_by` FOREIGN KEY (`handled_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_group_join_requests_requester` FOREIGN KEY (`requester_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB AUTO_INCREMENT = 2 DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '群聊加群申请记录表';
/*!40101 SET character_set_client = @saved_cs_client */
;

--
-- Dumping data for table `chat_group_join_requests`
--

/*!40000 ALTER TABLE `chat_group_join_requests` DISABLE KEYS */
;
INSERT INTO
    `chat_group_join_requests`
VALUES (
        1,
        10,
        11,
        '求求你了',
        'approved',
        8,
        '2026-04-22 16:03:11',
        NULL,
        '2026-04-29 16:02:43',
        '2026-04-22 16:02:43',
        '2026-04-23 00:03:13'
    );
/*!40000 ALTER TABLE `chat_group_join_requests` ENABLE KEYS */
;

--
-- Table structure for table `chat_message_receipts`
--

DROP TABLE IF EXISTS `chat_message_receipts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
CREATE TABLE `chat_message_receipts` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    `message_id` bigint unsigned NOT NULL COMMENT '消息ID',
    `user_id` bigint unsigned NOT NULL COMMENT '已读用户ID',
    `read_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '已读时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `ux_chat_receipts_message_user` (`message_id`, `user_id`),
    KEY `idx_chat_receipts_user` (`user_id`),
    KEY `idx_chat_receipts_read_at` (`read_at`),
    CONSTRAINT `fk_chat_receipts_message` FOREIGN KEY (`message_id`) REFERENCES `chat_messages` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_chat_receipts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB AUTO_INCREMENT = 205 DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '消息已读回执表';
/*!40101 SET character_set_client = @saved_cs_client */
;

--
-- Dumping data for table `chat_message_receipts`
--

/*!40000 ALTER TABLE `chat_message_receipts` DISABLE KEYS */
;
INSERT INTO
    `chat_message_receipts`
VALUES (
        193,
        195,
        8,
        '2026-04-22 11:31:17'
    ),
    (
        194,
        196,
        8,
        '2026-04-22 11:31:17'
    ),
    (
        195,
        198,
        11,
        '2026-04-22 14:58:15'
    ),
    (
        196,
        199,
        11,
        '2026-04-22 14:58:15'
    ),
    (
        197,
        200,
        11,
        '2026-04-22 16:03:13'
    ),
    (
        198,
        201,
        11,
        '2026-04-22 16:03:13'
    ),
    (
        199,
        197,
        11,
        '2026-04-24 01:18:29'
    ),
    (
        200,
        202,
        11,
        '2026-04-24 01:19:33'
    ),
    (
        201,
        203,
        8,
        '2026-04-24 01:19:48'
    ),
    (
        202,
        204,
        11,
        '2026-04-24 01:20:04'
    ),
    (
        203,
        205,
        11,
        '2026-04-24 01:34:49'
    ),
    (
        204,
        206,
        11,
        '2026-04-24 15:21:55'
    );
/*!40000 ALTER TABLE `chat_message_receipts` ENABLE KEYS */
;

--
-- Table structure for table `chat_messages`
--

DROP TABLE IF EXISTS `chat_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
CREATE TABLE `chat_messages` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '消息ID',
    `conversation_id` bigint unsigned NOT NULL COMMENT '会话ID',
    `sender_user_id` bigint unsigned NOT NULL COMMENT '发送者用户ID',
    `message_type` enum(
        'text',
        'image',
        'video',
        'audio',
        'file',
        'system'
    ) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'text' COMMENT '消息类型',
    `content` text COLLATE utf8mb4_unicode_ci COMMENT '消息文本内容',
    `extra` json DEFAULT NULL COMMENT '扩展字段(JSON)，如图片/文件信息、@信息等',
    `reply_to_message_id` bigint unsigned DEFAULT NULL COMMENT '引用回复的消息ID',
    `is_recalled` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否撤回：1是，0否',
    `recalled_at` datetime DEFAULT NULL COMMENT '撤回时间',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发送时间',
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    KEY `idx_chat_messages_conversation_time` (
        `conversation_id`,
        `created_at`
    ),
    KEY `idx_chat_messages_sender` (`sender_user_id`),
    KEY `idx_chat_messages_reply` (`reply_to_message_id`),
    KEY `idx_chat_messages_conversation_seq` (`conversation_id`, `id`),
    CONSTRAINT `fk_chat_messages_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_chat_messages_reply` FOREIGN KEY (`reply_to_message_id`) REFERENCES `chat_messages` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_chat_messages_sender` FOREIGN KEY (`sender_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB AUTO_INCREMENT = 207 DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '聊天消息表';
/*!40101 SET character_set_client = @saved_cs_client */
;

--
-- Dumping data for table `chat_messages`
--

/*!40000 ALTER TABLE `chat_messages` DISABLE KEYS */
;
INSERT INTO
    `chat_messages`
VALUES (
        195,
        7,
        11,
        'text',
        '桀桀桀',
        NULL,
        NULL,
        0,
        NULL,
        '2026-04-21 15:21:42',
        '2026-04-21 23:21:42'
    ),
    (
        196,
        7,
        11,
        'text',
        '在干什么呀',
        NULL,
        NULL,
        0,
        NULL,
        '2026-04-21 15:22:11',
        '2026-04-21 23:22:11'
    ),
    (
        197,
        7,
        8,
        'text',
        '摸鱼呀',
        NULL,
        NULL,
        0,
        NULL,
        '2026-04-22 14:57:18',
        '2026-04-22 22:57:20'
    ),
    (
        198,
        10,
        8,
        'system',
        '茶茶你怎么了 将 腐竹炒肉拌面 移出了群聊',
        NULL,
        NULL,
        0,
        NULL,
        '2026-04-22 14:57:59',
        '2026-04-22 22:58:01'
    ),
    (
        199,
        10,
        8,
        'system',
        '茶茶你怎么了 邀请 腐竹炒肉拌面 加入了群聊',
        NULL,
        NULL,
        0,
        NULL,
        '2026-04-22 14:58:13',
        '2026-04-22 22:58:15'
    ),
    (
        200,
        10,
        8,
        'system',
        '茶茶你怎么了 将 腐竹炒肉拌面 移出了群聊',
        NULL,
        NULL,
        0,
        NULL,
        '2026-04-22 16:00:39',
        '2026-04-23 00:00:41'
    ),
    (
        201,
        10,
        8,
        'system',
        '茶茶你怎么了 同意 腐竹炒肉拌面 的加群申请，腐竹炒肉拌面 已加入群聊',
        NULL,
        NULL,
        0,
        NULL,
        '2026-04-22 16:03:11',
        '2026-04-23 00:03:13'
    ),
    (
        202,
        7,
        8,
        'text',
        '锤你',
        NULL,
        NULL,
        0,
        NULL,
        '2026-04-24 01:19:29',
        '2026-04-24 09:19:29'
    ),
    (
        203,
        7,
        11,
        'text',
        '六百六十六',
        NULL,
        NULL,
        0,
        NULL,
        '2026-04-24 01:19:47',
        '2026-04-24 09:19:46'
    ),
    (
        204,
        7,
        8,
        'text',
        '喜喜',
        NULL,
        NULL,
        0,
        NULL,
        '2026-04-24 01:20:03',
        '2026-04-24 09:20:02'
    ),
    (
        205,
        7,
        8,
        'text',
        '干你哦',
        NULL,
        NULL,
        0,
        NULL,
        '2026-04-24 01:34:46',
        '2026-04-24 09:34:46'
    ),
    (
        206,
        10,
        8,
        'audio',
        '5a9a7e91244ab22212bc662f54656c17cb5e96b9877e72654e2e50d183271f7e_69eafc98.mp3',
        '{\"Width\": null, \"Height\": null, \"FileKey\": \"5a9a7e91244ab22212bc662f54656c17cb5e96b9877e72654e2e50d183271f7e_69eafc98.mp3\", \"FileUrl\": \"https://check.meowmemoirs.cn/mm/files/chat/5a9a7e91244ab22212bc662f54656c17cb5e96b9877e72654e2e50d183271f7e_69eafc98.mp3\", \"Duration\": 186.671292, \"FileName\": \"张韶涵,HOYO-MiX - 昔涟\", \"FileSize\": 3158570, \"MimeType\": \"audio/mpeg\", \"ThumbnailUrl\": null}',
        NULL,
        0,
        NULL,
        '2026-04-24 05:16:08',
        '2026-04-24 13:16:08'
    );
/*!40000 ALTER TABLE `chat_messages` ENABLE KEYS */
;

--
-- Table structure for table `checkin_plan_time_slots`
--

DROP TABLE IF EXISTS `checkin_plan_time_slots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
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
) ENGINE = InnoDB AUTO_INCREMENT = 28 DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '打卡计划时间段配置表（每日重复）';
/*!40101 SET character_set_client = @saved_cs_client */
;

--
-- Dumping data for table `checkin_plan_time_slots`
--

/*!40000 ALTER TABLE `checkin_plan_time_slots` DISABLE KEYS */
;
INSERT INTO
    `checkin_plan_time_slots`
VALUES (
        7,
        35,
        '晨勃',
        '06:00:00',
        '07:00:00',
        1,
        1,
        '2026-02-17 11:48:42',
        '2026-02-17 19:48:41'
    ),
    (
        8,
        35,
        '吃早饭',
        '08:00:00',
        '10:00:00',
        2,
        1,
        '2026-02-17 11:48:42',
        '2026-02-17 19:48:41'
    ),
    (
        9,
        35,
        '前推',
        '21:00:00',
        '23:01:00',
        3,
        1,
        '2026-02-17 11:48:42',
        '2026-02-17 19:48:41'
    ),
    (
        10,
        36,
        '水煎',
        '05:00:00',
        '06:00:00',
        1,
        1,
        '2026-02-20 04:55:42',
        '2026-02-20 12:55:41'
    ),
    (
        11,
        36,
        '晨勃',
        '07:00:00',
        '08:00:00',
        2,
        1,
        '2026-02-20 04:55:42',
        '2026-02-20 12:55:41'
    ),
    (
        12,
        36,
        '炒菜',
        '12:00:00',
        '14:00:00',
        3,
        1,
        '2026-02-20 04:55:42',
        '2026-02-20 12:55:41'
    ),
    (
        13,
        36,
        '做饭',
        '17:00:00',
        '18:00:00',
        4,
        1,
        '2026-02-20 04:55:42',
        '2026-02-20 12:55:41'
    ),
    (
        19,
        39,
        '招商',
        '09:00:00',
        '10:00:00',
        1,
        1,
        '2026-02-25 07:11:45',
        '2026-02-25 15:11:45'
    ),
    (
        20,
        38,
        '凌晨',
        '00:00:00',
        '06:00:00',
        1,
        1,
        '2026-02-25 08:11:19',
        '2026-02-25 16:11:19'
    ),
    (
        21,
        38,
        '早晨',
        '06:00:00',
        '11:00:00',
        2,
        1,
        '2026-02-25 08:11:19',
        '2026-02-25 16:11:19'
    ),
    (
        22,
        38,
        '中午',
        '11:00:00',
        '14:00:00',
        3,
        1,
        '2026-02-25 08:11:19',
        '2026-02-25 16:11:19'
    ),
    (
        23,
        38,
        '下午',
        '14:00:00',
        '18:00:00',
        4,
        1,
        '2026-02-25 08:11:19',
        '2026-02-25 16:11:19'
    ),
    (
        24,
        38,
        '晚上',
        '18:00:00',
        '23:59:59',
        5,
        1,
        '2026-02-25 08:11:19',
        '2026-02-25 16:11:19'
    );
/*!40000 ALTER TABLE `checkin_plan_time_slots` ENABLE KEYS */
;

--
-- Table structure for table `checkin_plans`
--

DROP TABLE IF EXISTS `checkin_plans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
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
) ENGINE = InnoDB AUTO_INCREMENT = 43 DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '打卡计划表';
/*!40101 SET character_set_client = @saved_cs_client */
;

--
-- Dumping data for table `checkin_plans`
--

/*!40000 ALTER TABLE `checkin_plans` DISABLE KEYS */
;
INSERT INTO
    `checkin_plans`
VALUES (
        10,
        7,
        '学习英语',
        '单词打卡',
        '2026-01-09',
        NULL,
        1,
        0,
        NULL,
        '2026-01-17 16:34:19',
        '2026-03-18 11:45:17',
        0
    ),
    (
        19,
        8,
        '起飞',
        '全勤',
        '2026-02-14',
        '2026-02-27',
        1,
        0,
        NULL,
        '2026-01-19 06:17:24',
        '2026-02-15 20:14:59',
        0
    ),
    (
        23,
        11,
        '开发打卡计划',
        '每日开发励志早日开发成功，',
        '2026-01-01',
        '2028-01-31',
        1,
        0,
        NULL,
        '2026-01-19 09:36:49',
        '2026-02-09 11:15:40',
        0
    ),
    (
        24,
        11,
        '二次开发计划',
        '第二次进行开发补强和查漏补缺',
        '2026-01-21',
        NULL,
        1,
        0,
        NULL,
        '2026-01-21 14:41:06',
        '2026-01-21 22:41:06',
        0
    ),
    (
        32,
        7,
        '健身',
        '锻炼身体',
        '2026-02-12',
        '2027-02-12',
        1,
        1,
        NULL,
        '2026-02-12 14:58:51',
        '2026-03-17 23:39:43',
        0
    ),
    (
        35,
        8,
        '分段时间打卡计划',
        '测试',
        '2026-01-01',
        '2048-02-14',
        1,
        0,
        NULL,
        '2026-02-14 13:47:03',
        '2026-02-18 22:54:58',
        1
    ),
    (
        36,
        11,
        '健身计划',
        '强身健体',
        '2026-02-20',
        '2026-02-21',
        1,
        0,
        NULL,
        '2026-02-20 04:55:42',
        '2026-02-20 13:11:31',
        1
    ),
    (
        37,
        7,
        '合成玉保卫战',
        '为了在年底井令和汐挑战不在非限定池下场',
        '2026-02-20',
        '2027-02-16',
        1,
        0,
        NULL,
        '2026-02-20 15:30:40',
        '2026-02-20 23:30:40',
        0
    ),
    (
        38,
        8,
        '分段打卡测试',
        '时间分段打卡测试',
        '2026-02-22',
        '2033-02-28',
        1,
        0,
        NULL,
        '2026-02-22 05:36:07',
        '2026-02-27 15:43:39',
        1
    ),
    (
        39,
        8,
        '计划列表测试',
        '测试在极限列表长度情况下的结果',
        '2026-02-25',
        '2026-03-20',
        1,
        1,
        NULL,
        '2026-02-25 07:11:45',
        '2026-02-25 15:13:14',
        0
    ),
    (
        42,
        11,
        '方舟资源储藏计划',
        '攒限定',
        '2026-02-27',
        NULL,
        1,
        0,
        NULL,
        '2026-02-27 10:14:49',
        '2026-02-27 18:14:48',
        0
    );
/*!40000 ALTER TABLE `checkin_plans` ENABLE KEYS */
;

--
-- Table structure for table `checkins`
--

DROP TABLE IF EXISTS `checkins`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
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
    UNIQUE KEY `ux_checkins_plan_date_slot` (
        `plan_id`,
        `check_date`,
        `time_slot_id`
    ),
    KEY `idx_checkins_user_date` (`user_id`, `check_date`),
    KEY `idx_checkins_status` (`status`),
    KEY `idx_checkins_is_deleted` (`is_deleted`),
    KEY `fk_checkins_time_slot` (`time_slot_id`),
    CONSTRAINT `fk_checkins_plan` FOREIGN KEY (`plan_id`) REFERENCES `checkin_plans` (`id`),
    CONSTRAINT `fk_checkins_time_slot` FOREIGN KEY (`time_slot_id`) REFERENCES `checkin_plan_time_slots` (`id`),
    CONSTRAINT `fk_checkins_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE = InnoDB AUTO_INCREMENT = 165 DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '打卡记录表';
/*!40101 SET character_set_client = @saved_cs_client */
;

--
-- Dumping data for table `checkins`
--

/*!40000 ALTER TABLE `checkins` DISABLE KEYS */
;
INSERT INTO
    `checkins`
VALUES (
        42,
        19,
        NULL,
        8,
        '2026-01-19',
        '[\"/mm/files/images/e74ead853224419faa3ae327f8295659.jpg\"]',
        '疯狂起飞',
        1,
        0,
        NULL,
        '2026-01-19 08:29:26',
        '2026-01-20 23:35:51'
    ),
    (
        43,
        23,
        NULL,
        11,
        '2026-01-19',
        '[\"/mm/files/images/ab97a616f07e437d830c40e1211e81d5.jpg\"]',
        '塑造认知',
        1,
        0,
        NULL,
        '2026-01-19 09:37:29',
        '2026-01-20 23:35:51'
    ),
    (
        44,
        10,
        NULL,
        7,
        '2026-01-18',
        '[\"/mm/files/images/2344b08e55414c71a9c792f60fa07109.jpg\"]',
        '10',
        2,
        0,
        NULL,
        '2026-01-19 10:05:14',
        '2026-01-20 23:35:51'
    ),
    (
        45,
        10,
        NULL,
        7,
        '2026-01-19',
        '[\"/mm/files/images/9a44201d676747c2add5b4067e2c0db0.jpg\"]',
        '11',
        1,
        0,
        NULL,
        '2026-01-19 15:54:04',
        '2026-01-20 23:35:51'
    ),
    (
        46,
        23,
        NULL,
        11,
        '2026-01-20',
        '[\"/mm/files/images/a659fd07d3864174bfd43277de65f890.jpg\"]',
        '准开发',
        1,
        0,
        NULL,
        '2026-01-20 14:12:06',
        '2026-01-20 23:35:51'
    ),
    (
        47,
        23,
        NULL,
        11,
        '2026-01-14',
        '[\"/mm/files/images/542cd8f56de3454599c2aa2746ba94d5.jpg\", \"/mm/files/images/186c67f900494529ab9020febdf38ae4.jpg\", \"/mm/files/images/5052fa165ebc4c55a2528faa35a47bcc.jpg\"]',
        '补档',
        2,
        0,
        NULL,
        '2026-01-20 14:52:23',
        '2026-01-20 23:35:51'
    ),
    (
        48,
        23,
        NULL,
        11,
        '2026-01-15',
        '[\"/mm/files/images/6d2df000ebb6424f9966655bd7ec21aa\", \"/mm/files/images/994111a4724f4387ae1f3f42f1ed5680\"]',
        '高频补档',
        2,
        0,
        NULL,
        '2026-01-20 15:18:53',
        '2026-01-20 23:18:57'
    ),
    (
        49,
        10,
        NULL,
        7,
        '2026-01-20',
        '[\"/mm/files/images/9fe84f326ddf49a689dbd77de0dc5a47.jpg\"]',
        '12',
        1,
        0,
        NULL,
        '2026-01-20 15:51:49',
        '2026-01-20 23:51:48'
    ),
    (
        50,
        23,
        NULL,
        11,
        '2026-01-21',
        '[\"/mm/files/images/718825a523e20c51ae2e722f5a97a6689705015476ae0414f58cde671c146818\", \"/mm/files/images/6eb15269e7b2f0260f142e3b0f85176795b7254396d3a07962fd7d8ebf7d3ee4\", \"/mm/files/images/13d266b36b8294721e20e8063777a1be27d6b367bbd1a90e4e6a063a367b9340\"]',
        '微信测试',
        1,
        0,
        NULL,
        '2026-01-21 03:36:45',
        '2026-01-21 11:36:44'
    ),
    (
        51,
        24,
        NULL,
        11,
        '2026-01-21',
        '[\"/mm/files/images/6820faf7b1f13030c1fe9b87c5ebce1014042923b9765ab84f13bf863abad2af\", \"/mm/files/images/8889b0f43558bd14dc9826bc02ebb7a24886be8eef3011ddb301c9b4d899e76f\", \"/mm/files/images/594e30e56c1640379bfa83caa4a45b4ecd448ea4f2acf676357e9a4b1aebe4c2\"]',
        '后方二次开发',
        1,
        0,
        NULL,
        '2026-01-21 14:51:30',
        '2026-01-21 22:51:29'
    ),
    (
        52,
        10,
        NULL,
        7,
        '2026-01-21',
        '[\"/mm/files/images/21ab4d8ac94acfea5b4f6e7afa962ae40dab55fbabd4a9cc1db16849abd50dec\"]',
        '13',
        1,
        0,
        NULL,
        '2026-01-21 15:06:23',
        '2026-01-21 23:06:22'
    ),
    (
        53,
        10,
        NULL,
        7,
        '2026-01-17',
        '[\"/mm/files/images/b6202689c2d299466c250e65c742919f4672ba32d318e40f9c3f3c04cbfdad1c\"]',
        '9',
        2,
        0,
        NULL,
        '2026-01-22 02:39:30',
        '2026-01-22 10:39:29'
    ),
    (
        54,
        10,
        NULL,
        7,
        '2026-01-16',
        '[\"/mm/files/images/7c9ddd30073ab2bae172279e87d7117698c8ae2f3be66d7db8d1b4ee9c547044\"]',
        '8',
        2,
        0,
        NULL,
        '2026-01-22 02:39:45',
        '2026-01-22 10:39:44'
    ),
    (
        55,
        10,
        NULL,
        7,
        '2026-01-15',
        '[\"/mm/files/images/6d4660221167c18719c4cccd5bb8133e24b2f0e1daeb13f0ff7407f46acb244c\"]',
        '7',
        2,
        0,
        NULL,
        '2026-01-22 02:40:03',
        '2026-01-22 10:40:03'
    ),
    (
        56,
        10,
        NULL,
        7,
        '2026-01-13',
        '[\"/mm/files/images/317dbca0e5e047ef254a2caee231e94d23c809b673ce31dc6bae4457d6a42fe4\"]',
        '5',
        2,
        0,
        NULL,
        '2026-01-22 02:40:20',
        '2026-01-22 10:40:20'
    ),
    (
        57,
        10,
        NULL,
        7,
        '2026-01-12',
        '[\"/mm/files/images/e0318025e0089e738bd6d2dc23b0f39cbca8d547a7ddc3f8787599f2e7c0916b\"]',
        '4',
        2,
        0,
        NULL,
        '2026-01-22 02:40:46',
        '2026-01-22 10:40:46'
    ),
    (
        58,
        10,
        NULL,
        7,
        '2026-01-11',
        '[\"/mm/files/images/6b3a20cc0abe5ae449169bd719bb7ee4e5970fa6baa58d02b9134e28b8237783\"]',
        '3',
        2,
        0,
        NULL,
        '2026-01-22 02:40:57',
        '2026-01-22 10:40:57'
    ),
    (
        59,
        10,
        NULL,
        7,
        '2026-01-10',
        '[\"/mm/files/images/7d1fcdae16b0f922dabf7142ba72081cd2d6fb5f2716ef44b126720bbc2c0434\"]',
        '2',
        2,
        0,
        NULL,
        '2026-01-22 02:41:08',
        '2026-01-22 10:41:07'
    ),
    (
        60,
        10,
        NULL,
        7,
        '2026-01-22',
        '[\"/mm/files/images/647a195ceec2010f90c8ac01a1cc7a7788a36f474c7df7cce26381db8c739531\"]',
        '14',
        1,
        0,
        NULL,
        '2026-01-22 15:55:11',
        '2026-01-22 23:55:10'
    ),
    (
        61,
        23,
        NULL,
        11,
        '2026-01-23',
        '[\"/mm/files/images/f73a62a74a870288842ea168bbacf80cb2f81ea4f1d6c2b4dd5fa28bf1b2e53c\", \"/mm/files/images/71e2614d826f1d8dcaff489054b656332a6830a459e6e1f15f0dc04ae2a95176\"]',
        '爱上打卡',
        1,
        0,
        NULL,
        '2026-01-23 16:41:01',
        '2026-01-24 00:41:11'
    ),
    (
        62,
        10,
        NULL,
        7,
        '2026-01-24',
        '[\"/mm/files/images/f8d0140847ac0083787a1ca0dda1784c9652d665c849b1a234eb6a18a7453cd3\"]',
        '16',
        1,
        0,
        NULL,
        '2026-01-24 15:34:07',
        '2026-01-24 23:34:07'
    ),
    (
        63,
        10,
        NULL,
        7,
        '2026-01-25',
        '[\"/mm/files/images/812e35a31e1140e70b22092380cca6d307fc51cfa1dde540e9e967f24702d193\"]',
        '17',
        1,
        0,
        NULL,
        '2026-01-25 15:56:18',
        '2026-01-25 23:56:18'
    ),
    (
        64,
        10,
        NULL,
        7,
        '2026-01-26',
        '[\"/mm/files/images/06f34d729c241957a1320bcc7e03c43f684a3d32fb1f5b8a8ecb3c4f2fae965c\"]',
        '18',
        1,
        0,
        NULL,
        '2026-01-26 13:16:43',
        '2026-01-26 21:16:42'
    ),
    (
        65,
        10,
        NULL,
        7,
        '2026-01-27',
        '[\"/mm/files/images/f1ef4ca2c04fbbca3521b480840e32e9b2884768b7e4dca652720287b9a81de8\"]',
        '19',
        1,
        0,
        NULL,
        '2026-01-27 15:30:17',
        '2026-01-27 23:30:17'
    ),
    (
        66,
        10,
        NULL,
        7,
        '2026-01-28',
        '[\"/mm/files/images/26d974bc527a92973c5b27ea26be6a91f4a910a0bb8ea3b9a68663701173ac21\"]',
        '20',
        1,
        0,
        NULL,
        '2026-01-28 15:27:30',
        '2026-01-28 23:27:29'
    ),
    (
        67,
        23,
        NULL,
        11,
        '2026-01-28',
        '[\"/mm/files/images/12226f7e6e5f5c908010840fbed1325371ec4cf63aa7b2b19082b33098743b75\", \"/mm/files/images/de1a7334e88960748eddeed3dbe2049631926177f9430dac814252876d57af4a\", \"/mm/files/images/38f13ceef930b6faae7252a3edec283f57c88dc9f8339462d9121d00a0863542\"]',
        '打卡打卡',
        1,
        0,
        NULL,
        '2026-01-28 16:29:30',
        '2026-01-29 00:29:29'
    ),
    (
        68,
        23,
        NULL,
        11,
        '2026-01-29',
        '[\"/mm/files/images/2a64fdef8cfadce9822864d6b447e0f577bf83eea3785ff46b9d8a356f35bb54\", \"/mm/files/images/a080097eca291a24413511cfd9b5ab388a82e7983ae8dfb1f5d095a61b200f99\", \"/mm/files/images/161af177f376d9af31f2fed516a2610596075512c9d4f7dfe1fab81344051ee1\"]',
        '开导开导',
        1,
        0,
        NULL,
        '2026-01-29 06:07:51',
        '2026-01-29 14:07:50'
    ),
    (
        69,
        10,
        NULL,
        7,
        '2026-01-29',
        '[\"/mm/files/images/9b367f19a54712df906bd596ad8b95230e5a1b12f4a1623347bf6fee18e8ef5f\"]',
        '21',
        1,
        0,
        NULL,
        '2026-01-29 14:32:37',
        '2026-01-29 22:32:36'
    ),
    (
        70,
        10,
        NULL,
        7,
        '2026-01-30',
        '[\"/mm/files/images/7f46e0cdb14800ddb05766d7dfadf1d9d5f2d27b287f8199a569cbe9b6600516\"]',
        '22',
        1,
        0,
        NULL,
        '2026-01-30 13:34:23',
        '2026-01-30 21:34:23'
    ),
    (
        71,
        24,
        NULL,
        11,
        '2026-01-31',
        '[\"/mm/files/images/dfebb623d569e9fa5d77f2d8910804376b7d08426524116d7fd2a4a89b70043e\"]',
        '偷偷摸摸的',
        1,
        0,
        NULL,
        '2026-01-31 15:10:20',
        '2026-01-31 23:10:19'
    ),
    (
        72,
        23,
        NULL,
        11,
        '2026-01-31',
        '[\"/mm/files/images/d8df24f62a0d54ade6c3170f8b832f1cbed87b10c2c95a0a50bf09ea42059d1a\", \"/mm/files/images/1b4856b3f9ae5eac287baebf75a2515ca41fefba37d5d210cb398ebc83e21d8a\", \"/mm/files/images/aa67cea1c43a7ae4a3c16b4d464cfb0312f0688710ac0f37b0fcb201eb18ce0d\"]',
        '桀桀桀',
        1,
        0,
        NULL,
        '2026-01-31 16:19:36',
        '2026-02-01 00:19:35'
    ),
    (
        73,
        23,
        NULL,
        11,
        '2026-02-01',
        '[\"/mm/files/images/f73a62a74a870288842ea168bbacf80cb2f81ea4f1d6c2b4dd5fa28bf1b2e53c\"]',
        NULL,
        1,
        0,
        NULL,
        '2026-02-01 06:09:05',
        '2026-02-01 14:09:05'
    ),
    (
        74,
        10,
        NULL,
        7,
        '2026-02-01',
        '[\"/mm/files/images/2459c544245cae128edd4200f33e0a00e7180084d20249b313f062073f5cc799\"]',
        '24',
        1,
        0,
        NULL,
        '2026-02-01 15:02:11',
        '2026-02-01 23:02:11'
    ),
    (
        75,
        10,
        NULL,
        7,
        '2026-02-02',
        '[\"/mm/files/images/ad03b5638195c378adb373f3d92b781d39fa7272959092799e86f21fcc67339d\"]',
        '25',
        1,
        0,
        NULL,
        '2026-02-02 15:32:42',
        '2026-02-02 23:32:42'
    ),
    (
        76,
        23,
        NULL,
        11,
        '2026-02-03',
        '[\"/mm/files/images/de1a7334e88960748eddeed3dbe2049631926177f9430dac814252876d57af4a\"]',
        '摩西摩西',
        1,
        0,
        NULL,
        '2026-02-03 06:50:35',
        '2026-02-03 14:50:35'
    ),
    (
        77,
        10,
        NULL,
        7,
        '2026-02-03',
        '[\"/mm/files/images/7b79087fa8745016e617cb67fafbeda7a0c13f5851c774112acf5131814dc1ac\"]',
        '26',
        1,
        0,
        NULL,
        '2026-02-03 15:36:05',
        '2026-02-03 23:36:05'
    ),
    (
        78,
        10,
        NULL,
        7,
        '2026-02-06',
        '[\"/mm/files/images/f15d9d9b12fc7d837a1b01ef6c90dedfec22ad675ace9dfad0b258194fd07647\"]',
        '28',
        1,
        0,
        NULL,
        '2026-02-06 15:29:13',
        '2026-02-06 23:29:12'
    ),
    (
        79,
        10,
        NULL,
        7,
        '2026-02-08',
        '[\"/mm/files/images/e73ccd1ba4fefcca41136c06873e6eacfbd714b273f60e8cd2df95c5cc3bcbac\"]',
        '30',
        1,
        0,
        NULL,
        '2026-02-08 15:31:40',
        '2026-02-08 23:31:39'
    ),
    (
        80,
        24,
        NULL,
        11,
        '2026-02-04',
        '[\"/mm/files/images/6820faf7b1f13030c1fe9b87c5ebce1014042923b9765ab84f13bf863abad2af\"]',
        '爱好绘画',
        2,
        0,
        NULL,
        '2026-02-08 15:40:51',
        '2026-02-08 23:40:50'
    ),
    (
        81,
        23,
        NULL,
        11,
        '2026-02-09',
        '[\"/mm/files/images/e6d5b17c3d717e5fa6e8c18dfd94b2265b3abb2f908c0575f5dc88848535e3b7\"]',
        '本地打卡',
        1,
        0,
        NULL,
        '2026-02-09 02:54:53',
        '2026-02-09 10:54:53'
    ),
    (
        82,
        24,
        NULL,
        11,
        '2026-02-09',
        '[\"/mm/files/images/5e3ed286b733e5ea9aca0d44df4a5e789fc6c4503c17af99e0fa20c589a03e78\"]',
        '打卡',
        1,
        0,
        NULL,
        '2026-02-09 05:37:19',
        '2026-02-09 13:37:19'
    ),
    (
        83,
        24,
        NULL,
        11,
        '2026-02-08',
        '[\"/mm/files/images/5d9d4c970875428694f22dceb01872b36077412f1811f91e8ba6420603e7c0c2\", \"/mm/files/images/fbd390e724b84179731a8d282d15a64a42b60e556f2e115babacedcf3b46c3d7\"]',
        '强撸灰飞烟灭',
        2,
        0,
        NULL,
        '2026-02-09 09:31:00',
        '2026-02-09 17:31:00'
    ),
    (
        84,
        10,
        NULL,
        7,
        '2026-02-09',
        '[\"/mm/files/images/b0032ad290f0eb96c5a85ba8a247bdfe8ef3ddd11c2b2e7f71271023ea5dbf32\"]',
        '31',
        1,
        0,
        NULL,
        '2026-02-09 15:37:22',
        '2026-02-09 23:37:22'
    ),
    (
        85,
        10,
        NULL,
        7,
        '2026-02-11',
        '[\"/mm/files/images/094d694290f839162f73f028409bc4e3056f68a1845322a72dc4070f303e9705\"]',
        '33',
        1,
        0,
        NULL,
        '2026-02-11 14:25:16',
        '2026-02-11 22:25:15'
    ),
    (
        86,
        10,
        NULL,
        7,
        '2026-02-12',
        '[\"/mm/files/images/15951134a2c044de25bbfcad29eb5b8e2d4495f21cb48a3e4a0b5224c28514bd\"]',
        '34',
        1,
        0,
        NULL,
        '2026-02-12 14:20:52',
        '2026-02-12 22:20:52'
    ),
    (
        87,
        32,
        NULL,
        7,
        '2026-02-12',
        '[\"/mm/files/images/4adb26e315e52f3fa7d057e7d1761b0d37ebf25a2b5eb4273705404d5f80b543\"]',
        '肩颈',
        1,
        0,
        NULL,
        '2026-02-12 15:22:29',
        '2026-02-12 23:22:29'
    ),
    (
        88,
        10,
        NULL,
        7,
        '2026-02-13',
        '[\"/mm/files/images/4cc17f1bcb09dad8d1e7575e2d33b93883f4371994368554b5add41fcf1453c0\"]',
        '35',
        1,
        0,
        NULL,
        '2026-02-13 15:42:40',
        '2026-02-13 23:42:40'
    ),
    (
        90,
        10,
        NULL,
        7,
        '2026-02-14',
        '[\"/mm/files/images/e4a40dddcd6a80f0790df1bc972811ec96a6870acd064056530086cbbd79bada\"]',
        '36',
        1,
        0,
        NULL,
        '2026-02-14 15:46:35',
        '2026-02-14 23:46:35'
    ),
    (
        95,
        35,
        9,
        8,
        '2026-02-17',
        '[\"/mm/files/images/9d69b1b74a076c2b43f9a9979ad735b9078eda3a1c1e4662c9514ad26ed2b4b5\"]',
        'daka ',
        1,
        0,
        NULL,
        '2026-02-17 13:59:58',
        '2026-02-17 21:59:57'
    ),
    (
        96,
        10,
        NULL,
        7,
        '2026-02-15',
        '[\"/mm/files/images/6a77a320a1a33e8fc2068d3c740b409bf5041c174cba9b501989d74eb48ccd3a\"]',
        '37',
        1,
        0,
        NULL,
        '2026-02-18 20:45:55',
        '2026-02-18 20:45:55'
    ),
    (
        97,
        10,
        NULL,
        7,
        '2026-02-16',
        '[\"/mm/files/images/23a9c15c7a4daf754718cf4f8ec67bca77b01bd026cd5e380f5f3031d5c44d04\"]',
        '38',
        1,
        0,
        NULL,
        '2026-02-18 20:47:52',
        '2026-02-18 20:47:52'
    ),
    (
        98,
        10,
        NULL,
        7,
        '2026-02-17',
        '[\"/mm/files/images/ac9d67774adf00c461adace97d9ad72002f87a3d78dea1c5e6268d127cd47ef2\"]',
        '39',
        1,
        0,
        NULL,
        '2026-02-18 20:48:43',
        '2026-02-18 20:48:43'
    ),
    (
        99,
        10,
        NULL,
        7,
        '2026-02-19',
        '[\"/mm/files/images/a3f3f4ec5a3f57a6b78da87ff9fb79629cf33ebb5ae36170a8297cbcbe448346\"]',
        '40',
        1,
        0,
        NULL,
        '2026-02-19 15:59:51',
        '2026-02-19 23:59:51'
    ),
    (
        100,
        10,
        NULL,
        7,
        '2026-02-20',
        '[\"/mm/files/images/25c03c93af413646c6d10b8f3b16958f0d2184616cfb43cff5b922d28ce5b229\"]',
        '41',
        1,
        0,
        NULL,
        '2026-02-20 15:31:03',
        '2026-02-20 23:31:03'
    ),
    (
        101,
        37,
        NULL,
        7,
        '2026-02-20',
        '[\"/mm/files/images/12747e12ae9a128d7d8909f1514386d311bcfb315decd7296e495dc06b6be828\"]',
        '17125',
        1,
        0,
        NULL,
        '2026-02-20 15:34:28',
        '2026-02-20 23:34:28'
    ),
    (
        102,
        35,
        7,
        8,
        '2026-02-20',
        '[\"/mm/files/images/9d69b1b74a076c2b43f9a9979ad735b9078eda3a1c1e4662c9514ad26ed2b4b5\", \"/mm/files/images/aa67cea1c43a7ae4a3c16b4d464cfb0312f0688710ac0f37b0fcb201eb18ce0d\", \"/mm/files/images/d8df24f62a0d54ade6c3170f8b832f1cbed87b10c2c95a0a50bf09ea42059d1a\"]',
        '补卡',
        2,
        0,
        NULL,
        '2026-02-20 16:30:19',
        '2026-02-21 00:30:18'
    ),
    (
        103,
        19,
        NULL,
        8,
        '2026-02-14',
        '[\"/mm/files/images/dfebb623d569e9fa5d77f2d8910804376b7d08426524116d7fd2a4a89b70043e\"]',
        '测试打卡',
        2,
        0,
        NULL,
        '2026-02-20 16:34:13',
        '2026-02-21 00:34:13'
    ),
    (
        104,
        19,
        NULL,
        8,
        '2026-02-21',
        '[\"/mm/files/images/03294271ae15fd050dca6eb8c76641e3eaf7274de5b58a83b3d58a5b375d4276\", \"/mm/files/images/8889b0f43558bd14dc9826bc02ebb7a24886be8eef3011ddb301c9b4d899e76f\", \"/mm/files/images/594e30e56c1640379bfa83caa4a45b4ecd448ea4f2acf676357e9a4b1aebe4c2\"]',
        '摸胸',
        1,
        0,
        NULL,
        '2026-02-21 12:43:03',
        '2026-02-21 20:43:03'
    ),
    (
        105,
        35,
        9,
        8,
        '2026-02-21',
        '[\"/mm/files/images/6eb15269e7b2f0260f142e3b0f85176795b7254396d3a07962fd7d8ebf7d3ee4\", \"/mm/files/images/9375111714deca2f60487f60e67f801de2dbe4c22c1de48b32aa7705a3f87a40\"]',
        '水煎',
        1,
        0,
        NULL,
        '2026-02-21 14:03:56',
        '2026-02-21 22:03:55'
    ),
    (
        106,
        19,
        NULL,
        8,
        '2026-02-20',
        '[\"/mm/files/images/5defcb4d15221d5845401f3e7fd8e90ab6eb4a189650190ce7c92a5e9993a26c\"]',
        '摸福',
        2,
        0,
        NULL,
        '2026-02-21 14:04:51',
        '2026-02-21 22:04:51'
    ),
    (
        107,
        35,
        8,
        8,
        '2026-02-21',
        '[\"/mm/files/images/daf77d5e471153838d3e42b24937e42254358f75ada2309b932254b76040316c\", \"/mm/files/images/13d266b36b8294721e20e8063777a1be27d6b367bbd1a90e4e6a063a367b9340\"]',
        '炒菜',
        2,
        0,
        NULL,
        '2026-02-21 14:32:54',
        '2026-02-21 22:32:53'
    ),
    (
        108,
        10,
        NULL,
        7,
        '2026-02-21',
        '[\"/mm/files/images/887663a57a8521913d65450c348ae1fc5483acf18a5c7f454ddb6424d58de3da\"]',
        '42',
        1,
        0,
        NULL,
        '2026-02-21 15:45:04',
        '2026-02-21 23:45:03'
    ),
    (
        109,
        10,
        NULL,
        7,
        '2026-02-22',
        '[\"/mm/files/images/872983c4498f07e98dbd235b401602d9a25977b63c4202e87f8ce922428a1995\"]',
        '43',
        1,
        0,
        NULL,
        '2026-02-22 15:37:34',
        '2026-02-22 23:37:34'
    ),
    (
        110,
        37,
        NULL,
        7,
        '2026-02-22',
        '[\"/mm/files/images/438b3cf1f3f448f1d1a593d823812ab2628bd15df08a5ad89713a2c5b6df141c\"]',
        '2935',
        1,
        0,
        NULL,
        '2026-02-22 15:37:57',
        '2026-02-22 23:37:57'
    ),
    (
        111,
        36,
        13,
        11,
        '2026-02-20',
        '[\"/mm/files/images/89e72ab08e34b54abb8fd658519ce7b33e7ba154151df446c230668baa9e445c\", \"/mm/files/images/3bf4ccfb5a9e811ab94c591d0d96dafee42bbdbc32a66f21566618e66be44369\"]',
        '桀桀桀',
        2,
        0,
        NULL,
        '2026-02-22 16:41:28',
        '2026-02-23 00:41:28'
    ),
    (
        112,
        10,
        NULL,
        7,
        '2026-02-24',
        '[\"/mm/files/images/90073512edb4404625825ac6872321b8f3502b27b61608c2136cdf852c43f8e6\"]',
        '44',
        1,
        0,
        NULL,
        '2026-02-24 13:51:47',
        '2026-02-24 21:51:46'
    ),
    (
        113,
        35,
        8,
        8,
        '2026-02-26',
        '[\"/mm/files/images/0833ad84c2932df3701bc3712a8fb5066c6fb277917a363b823ec603208d5613\"]',
        '的吃啦',
        2,
        0,
        NULL,
        '2026-02-26 03:35:10',
        '2026-02-26 16:29:23'
    ),
    (
        118,
        35,
        7,
        8,
        '2026-02-25',
        '[\"/mm/files/images/fbdaa9aac41dd37c80627fa90388a75a532a83d38333e86cc32cacafa7d2f480\"]',
        '测试',
        2,
        0,
        NULL,
        '2026-02-26 11:44:37',
        '2026-02-26 19:44:37'
    ),
    (
        119,
        35,
        9,
        8,
        '2026-02-19',
        '[\"/mm/files/images/704864086cc72cbbc5a5f106a964f6c7991e0aa09fa4c9abe35b039084c95ff1\", \"/mm/files/images/20615f67178083d472eab4ccfa6c96d8a4aeb375ce08bef81741f69ccc703bfc\"]',
        'aaa小情人',
        2,
        0,
        NULL,
        '2026-02-26 14:34:23',
        '2026-02-26 22:34:22'
    ),
    (
        120,
        35,
        8,
        8,
        '2026-02-19',
        '[\"/mm/files/images/ae18f790aa4ef41cb630407b32465d12739f82918791354efb54e226bba812c4\"]',
        '1',
        2,
        0,
        NULL,
        '2026-02-26 15:00:42',
        '2026-02-26 23:00:42'
    ),
    (
        121,
        35,
        7,
        8,
        '2026-02-19',
        '[\"/mm/files/images/69ad0e0921b94f41792a55dcc3fb02e57e88c8d69dc1f42a86b6bee0a942412b\"]',
        '111',
        2,
        0,
        NULL,
        '2026-02-26 15:01:45',
        '2026-02-26 23:01:45'
    ),
    (
        122,
        10,
        NULL,
        7,
        '2026-02-26',
        '[\"/mm/files/images/c546139b9a6d15844190d4ce5544326994f59a7f66f0d819b2dac88b564dbff5\"]',
        '45',
        1,
        0,
        NULL,
        '2026-02-26 15:07:11',
        '2026-02-26 23:07:10'
    ),
    (
        123,
        35,
        7,
        8,
        '2026-01-23',
        '[\"/mm/files/images/5b24bb73c8cbe8fed32394058a2595afb5d4fa5923584cde1030b10888ff24f6\"]',
        '8888',
        2,
        0,
        NULL,
        '2026-02-27 03:05:45',
        '2026-02-27 11:05:44'
    ),
    (
        124,
        38,
        23,
        8,
        '2026-02-27',
        '[\"/mm/files/images/8261461f7e92c3141920da21bd86f7e79689c8974e981f97e8f81ec0b7d76fd3\", \"/mm/files/images/9814ad85f3c1a40538b921d62982fc18be4240a2b0b5ea4b06b099f3926472f4\", \"/mm/files/images/56ea67478f7258f9432f46822803e645f4e192aa8966d49c64a5dc3ab3628f48\"]',
        '爱死',
        1,
        0,
        NULL,
        '2026-02-27 07:39:37',
        '2026-02-27 15:39:36'
    ),
    (
        125,
        35,
        8,
        8,
        '2026-01-30',
        '[\"/mm/files/images/de1a7334e88960748eddeed3dbe2049631926177f9430dac814252876d57af4a\"]',
        '11111111',
        2,
        0,
        NULL,
        '2026-02-27 08:24:32',
        '2026-02-27 16:24:32'
    ),
    (
        126,
        42,
        NULL,
        11,
        '2026-02-27',
        '[\"/mm/files/images/d05f983091c391a936ea3a707f5245f62486e675fac78d08be7b359c708ef7df\"]',
        '1014',
        1,
        0,
        NULL,
        '2026-02-27 10:28:34',
        '2026-02-27 18:28:34'
    ),
    (
        127,
        10,
        NULL,
        7,
        '2026-02-27',
        '[\"/mm/files/images/1a9d92c886ba88238f78d7df327ec5482097e9ecb947134469dee152cd0642b2\"]',
        '46',
        1,
        0,
        NULL,
        '2026-02-27 15:58:59',
        '2026-02-27 23:58:58'
    ),
    (
        128,
        42,
        NULL,
        11,
        '2026-03-01',
        '[\"/mm/files/images/68575ca4bb9e27d2ffc9785b159d2fe4249f0c3572bfb7fcec61f017c4c47727\"]',
        '2114',
        1,
        0,
        NULL,
        '2026-03-01 07:54:35',
        '2026-03-01 15:54:34'
    ),
    (
        129,
        10,
        NULL,
        7,
        '2026-03-01',
        '[\"/mm/files/images/7e1631e4384120180739e4493847dc56a457e4102662c5f433f84b9c8923581e\"]',
        '47',
        1,
        0,
        NULL,
        '2026-03-01 15:59:15',
        '2026-03-01 23:59:14'
    ),
    (
        130,
        37,
        NULL,
        7,
        '2026-03-01',
        '[\"/mm/files/images/1a342d3ae2b459af6cd1dcde6ab48a99a64a194a587c986b45f74534eabb3ed2\"]',
        '5800',
        1,
        0,
        NULL,
        '2026-03-01 15:59:39',
        '2026-03-01 23:59:39'
    ),
    (
        131,
        10,
        NULL,
        7,
        '2026-03-02',
        '[\"/mm/files/images/9b7b99ae8c3d1c581ba101c590c611e381397fea3380ba1abbb3f4d9d419f90f\"]',
        '48',
        1,
        0,
        NULL,
        '2026-03-02 15:07:29',
        '2026-03-02 23:07:28'
    ),
    (
        132,
        10,
        NULL,
        7,
        '2026-03-03',
        '[\"/mm/files/images/1daaf0e0ff9ecd5b692bef25a76e129c008c09e247bd0058261a6d65412e54d9\"]',
        '49',
        1,
        0,
        NULL,
        '2026-03-03 15:37:39',
        '2026-03-03 23:37:39'
    ),
    (
        133,
        37,
        NULL,
        7,
        '2026-03-03',
        '[\"/mm/files/images/a02cb09da015722e17b1bed3bd47c6649a16aae48e616e958ee7ccf22388d854\"]',
        '7815',
        1,
        0,
        NULL,
        '2026-03-03 17:35:57',
        '2026-03-04 01:35:56'
    ),
    (
        134,
        10,
        NULL,
        7,
        '2026-03-04',
        '[\"/mm/files/images/ac1a2c517c06ff1c9572beb46b4ba791e788c2425f1b45c952bb22e81b2cdff5\"]',
        '50',
        1,
        0,
        NULL,
        '2026-03-04 15:11:41',
        '2026-03-04 23:11:41'
    ),
    (
        135,
        37,
        NULL,
        7,
        '2026-03-04',
        '[\"/mm/files/images/7c3b209ac00d19e370f5d14fc0aba03ec071c06d3dbe09c876c236a2d9522738\"]',
        '8285',
        1,
        0,
        NULL,
        '2026-03-04 16:27:22',
        '2026-03-05 00:27:22'
    ),
    (
        136,
        10,
        NULL,
        7,
        '2026-03-05',
        '[\"/mm/files/images/89e7b8d3dd398d3e596191845360ec85f4ee85508b05f67ffdecba6e3758b4ed\"]',
        '51',
        1,
        0,
        NULL,
        '2026-03-05 15:59:22',
        '2026-03-05 23:59:21'
    ),
    (
        137,
        10,
        NULL,
        7,
        '2026-03-06',
        '[\"/mm/files/images/1292ec5d825dc30af16bc8effa28dc4583cf55f5b89d636f48b3961a78140243\"]',
        '52',
        1,
        0,
        NULL,
        '2026-03-06 15:52:27',
        '2026-03-06 23:52:26'
    ),
    (
        138,
        37,
        NULL,
        7,
        '2026-03-06',
        '[\"/mm/files/images/0995d76a4d25543c251912606e22de94d5c1bf1b4ca37e5bcc13b5b35ade2526\"]',
        '8705',
        1,
        0,
        NULL,
        '2026-03-06 15:52:51',
        '2026-03-06 23:52:50'
    ),
    (
        139,
        37,
        NULL,
        7,
        '2026-03-07',
        '[\"/mm/files/images/60c118ac075cc208e37d14aa42b514c3963c7c952d19f22904b714f3303f0b7d\"]',
        '8805',
        1,
        0,
        NULL,
        '2026-03-07 15:58:35',
        '2026-03-07 23:58:35'
    ),
    (
        140,
        10,
        NULL,
        7,
        '2026-03-07',
        '[\"/mm/files/images/d6462f242692dc503f4bc91012a1cf052764e64aad0ea2d0980373c44917b539\"]',
        '53',
        1,
        0,
        NULL,
        '2026-03-07 16:03:03',
        '2026-03-08 00:03:02'
    ),
    (
        141,
        37,
        NULL,
        7,
        '2026-03-09',
        '[\"/mm/files/images/08454b41614bfe3eb757c8c68345945995254429e74c2e4f4dfc804b53288b25\"]',
        '9145',
        2,
        0,
        NULL,
        '2026-03-10 00:16:34',
        '2026-03-10 08:16:34'
    ),
    (
        142,
        10,
        NULL,
        7,
        '2026-03-10',
        '[\"/mm/files/images/773f43870c765884d09ca363cc6fd3008460a35570dc3d90e446032cdf56eb7b\"]',
        '55',
        1,
        0,
        NULL,
        '2026-03-10 14:16:05',
        '2026-03-10 22:16:04'
    ),
    (
        143,
        37,
        NULL,
        7,
        '2026-03-10',
        '[\"/mm/files/images/bae5d8145bc48f2f6f3e6ba96da4f9ab64bb5267751be7c209761a64cffed36f\"]',
        '11785',
        1,
        0,
        NULL,
        '2026-03-10 14:16:27',
        '2026-03-10 22:16:27'
    ),
    (
        144,
        10,
        NULL,
        7,
        '2026-03-11',
        '[\"/mm/files/images/9271320182a71dc7b4d180d8525ac1551ce0dca1d2350d02fed68cffd053cae0\"]',
        '56',
        1,
        0,
        NULL,
        '2026-03-11 14:12:23',
        '2026-03-11 22:12:22'
    ),
    (
        145,
        37,
        NULL,
        7,
        '2026-03-11',
        '[\"/mm/files/images/e663fd6315055a951c67beca3d40b00c77b82f4e8474517245481f72313dc311\"]',
        '12080',
        1,
        0,
        NULL,
        '2026-03-11 14:31:08',
        '2026-03-11 22:31:07'
    ),
    (
        146,
        38,
        24,
        8,
        '2026-03-12',
        '[\"/mm/files/images/369edcd655141f9b1d561590a3c9f2ba628f829c7e5daf09c307e859bf9882cb\"]',
        '桀桀桀',
        1,
        0,
        NULL,
        '2026-03-12 15:06:13',
        '2026-03-12 23:06:12'
    ),
    (
        147,
        10,
        NULL,
        7,
        '2026-03-12',
        '[\"/mm/files/images/4540c36f70aa5e0834c3ba5da138eaee389897d337b6e14a90729a0eebabd756\"]',
        '57',
        1,
        0,
        NULL,
        '2026-03-12 15:58:32',
        '2026-03-12 23:58:32'
    ),
    (
        148,
        37,
        NULL,
        7,
        '2026-03-12',
        '[\"/mm/files/images/7b5374511ed8613d50cdcdf8e03a46c00016b1fc770db42b1a0544fd80931bd4\"]',
        '12385',
        1,
        0,
        NULL,
        '2026-03-12 15:58:51',
        '2026-03-12 23:58:51'
    ),
    (
        149,
        10,
        NULL,
        7,
        '2026-03-13',
        '[\"/mm/files/images/24d67a12267f4184d7fdd50e9ce4ddbf4c3d363675198c3f266eea1d9d86b7bc\"]',
        '58',
        1,
        0,
        NULL,
        '2026-03-13 15:41:36',
        '2026-03-13 23:41:36'
    ),
    (
        150,
        37,
        NULL,
        7,
        '2026-03-14',
        '[\"/mm/files/images/0324dbad27fe4fcc458594fa00f285b569f6f461436addde9426feb834634698\"]',
        '13305',
        1,
        0,
        NULL,
        '2026-03-14 16:00:17',
        '2026-03-15 00:00:16'
    ),
    (
        151,
        10,
        NULL,
        7,
        '2026-03-15',
        '[\"/mm/files/images/b8f222c1273f15459b3d4e881381ad949d6073546e7b9ed07ea64776486e304f\"]',
        '59',
        1,
        0,
        NULL,
        '2026-03-15 15:38:39',
        '2026-03-15 23:38:39'
    ),
    (
        152,
        37,
        NULL,
        7,
        '2026-03-15',
        '[\"/mm/files/images/5e0c898a21610bc72781829602d8fb653fde5468e1e59372124220dde6bf3201\"]',
        '14105',
        1,
        0,
        NULL,
        '2026-03-15 15:38:59',
        '2026-03-15 23:38:59'
    ),
    (
        153,
        37,
        NULL,
        7,
        '2026-03-17',
        '[\"/mm/files/images/7200637dd8d6cedb38e52d322c5a9e36c274e0a6eb9f95078edd8396457ea1cf\"]',
        '15535',
        1,
        0,
        NULL,
        '2026-03-17 15:40:10',
        '2026-03-17 23:40:10'
    ),
    (
        154,
        37,
        NULL,
        7,
        '2026-03-21',
        '[\"/mm/files/images/49c8b9472e824ca8a8fa21a8cd2d6e37a7d81e68fca0f30b739b9108f7ca44ca\"]',
        '17325',
        1,
        0,
        NULL,
        '2026-03-21 12:39:27',
        '2026-03-21 20:39:27'
    ),
    (
        155,
        42,
        NULL,
        11,
        '2026-03-21',
        '[\"/mm/files/images/7629dd93c6fcf6c95083be33246e7117432ed7c8480f22399b041793f2cf49e9\"]',
        '5974',
        1,
        0,
        NULL,
        '2026-03-21 13:22:33',
        '2026-03-21 21:22:32'
    ),
    (
        156,
        42,
        NULL,
        11,
        '2026-03-22',
        '[\"/mm/files/images/01d0bee916394073aaa24f1e021cd8124162514a9ee2febb25dff1bdbd9f5eb1\"]',
        '6584',
        1,
        0,
        NULL,
        '2026-03-22 10:32:24',
        '2026-03-22 18:32:23'
    ),
    (
        157,
        37,
        NULL,
        7,
        '2026-03-22',
        '[\"/mm/files/images/f13d2a9a8162420518af35f29c781a15ef70f3cb4909e907782981d9d534beca\"]',
        '17625',
        1,
        0,
        NULL,
        '2026-03-22 15:17:51',
        '2026-03-22 23:17:50'
    ),
    (
        158,
        42,
        NULL,
        11,
        '2026-03-23',
        '[\"/mm/files/images/9b8fb5e80779333a699c4baa5144a545b0d56ba502f2320f6f8e93a1ab8f7e3d\"]',
        '6824',
        1,
        0,
        NULL,
        '2026-03-23 15:00:27',
        '2026-03-23 23:00:27'
    ),
    (
        159,
        42,
        NULL,
        11,
        '2026-03-25',
        '[\"/mm/files/images/b0cdea34633b44844b64632b846f2bd8df32a297fa6c4d7f2c210abe1350147f\"]',
        '8404',
        1,
        0,
        NULL,
        '2026-03-25 14:18:15',
        '2026-03-25 22:18:14'
    ),
    (
        160,
        37,
        NULL,
        7,
        '2026-03-26',
        '[\"/mm/files/images/c48d2852a4b302a110b4fe1db57227f5d80e6952f49441dc1ef7ef83a2eb7ccd\"]',
        '18495',
        1,
        0,
        NULL,
        '2026-03-26 15:00:15',
        '2026-03-26 23:00:15'
    ),
    (
        161,
        42,
        NULL,
        11,
        '2026-03-28',
        '[\"/mm/files/images/702ecee4b847ba54086ac452e3fca6da14fe31e28e9f35fc484fb550584a01ee\"]',
        '11394',
        1,
        0,
        NULL,
        '2026-03-28 16:05:37',
        '2026-03-29 00:05:37'
    ),
    (
        162,
        42,
        NULL,
        11,
        '2026-03-29',
        '[\"/mm/files/images/736a1fa01bbb4a75b486af97956b9a8496ed8b7d8a88248ca337dc26cb2cc4c6\"]',
        '12224',
        1,
        0,
        NULL,
        '2026-03-29 14:35:45',
        '2026-03-29 22:35:44'
    ),
    (
        163,
        42,
        NULL,
        11,
        '2026-03-30',
        '[\"/mm/files/images/bc75b578be5925e6ae9d5af52e8aee1fe62918562b8aad7d27eefd98764c883a\"]',
        '12524',
        1,
        0,
        NULL,
        '2026-03-30 14:03:48',
        '2026-03-30 22:03:49'
    ),
    (
        164,
        35,
        8,
        8,
        '2026-04-06',
        '[\"/mm/files/images/d28e9dedbc8b3da8cf90fb85b1d66e5bfc886c257c45c54d2ab4531829ac53f4\"]',
        '检查',
        2,
        0,
        NULL,
        '2026-04-06 14:39:42',
        '2026-04-06 22:39:46'
    );
/*!40000 ALTER TABLE `checkins` ENABLE KEYS */
;

--
-- Table structure for table `soft_delete_logs`
--

DROP TABLE IF EXISTS `soft_delete_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
CREATE TABLE `soft_delete_logs` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    `table_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '伪删除记录所属表名',
    `record_id` bigint unsigned NOT NULL COMMENT '被伪删除记录的主键ID',
    `deleter_user_id` bigint unsigned DEFAULT NULL COMMENT '执行伪删除操作的用户ID',
    `reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '伪删除原因',
    `deleted_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '伪删除时间',
    `extra` json DEFAULT NULL COMMENT '扩展信息(JSON)，如数据快照等',
    PRIMARY KEY (`id`),
    KEY `idx_soft_delete_table_record` (`table_name`, `record_id`),
    KEY `idx_soft_delete_deleted_at` (`deleted_at`),
    KEY `fk_soft_delete_deleter` (`deleter_user_id`),
    CONSTRAINT `fk_soft_delete_deleter` FOREIGN KEY (`deleter_user_id`) REFERENCES `users` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '伪删除操作日志表';
/*!40101 SET character_set_client = @saved_cs_client */
;

--
-- Dumping data for table `soft_delete_logs`
--

/*!40000 ALTER TABLE `soft_delete_logs` DISABLE KEYS */
;
/*!40000 ALTER TABLE `soft_delete_logs` ENABLE KEYS */
;

--
-- Table structure for table `user_activity`
--

DROP TABLE IF EXISTS `user_activity`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
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
    KEY `idx_activity_user_created` (`user_id`, `created_at`),
    KEY `idx_activity_created` (`created_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '用户行为埋点日志表';
/*!40101 SET character_set_client = @saved_cs_client */
;

--
-- Dumping data for table `user_activity`
--

/*!40000 ALTER TABLE `user_activity` DISABLE KEYS */
;
/*!40000 ALTER TABLE `user_activity` ENABLE KEYS */
;

--
-- Table structure for table `user_blacklist_records`
--

DROP TABLE IF EXISTS `user_blacklist_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
CREATE TABLE `user_blacklist_records` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    `user_id` bigint unsigned NOT NULL COMMENT '被拉黑的用户ID',
    `operator_user_id` bigint unsigned DEFAULT NULL COMMENT '执行操作的管理员用户ID',
    `reason` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '拉黑或解封原因',
    `status` tinyint(1) NOT NULL COMMENT '状态：1拉黑，0解封（历史记录）',
    `occurred_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作发生时间',
    PRIMARY KEY (`id`),
    KEY `idx_blacklist_user` (`user_id`, `occurred_at`),
    KEY `fk_blacklist_operator` (`operator_user_id`),
    CONSTRAINT `fk_blacklist_operator` FOREIGN KEY (`operator_user_id`) REFERENCES `users` (`id`),
    CONSTRAINT `fk_blacklist_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '用户黑名单记录表';
/*!40101 SET character_set_client = @saved_cs_client */
;

--
-- Dumping data for table `user_blacklist_records`
--

/*!40000 ALTER TABLE `user_blacklist_records` DISABLE KEYS */
;
/*!40000 ALTER TABLE `user_blacklist_records` ENABLE KEYS */
;

--
-- Table structure for table `user_friend_requests`
--

DROP TABLE IF EXISTS `user_friend_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
CREATE TABLE `user_friend_requests` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
    `requester_user_id` bigint unsigned NOT NULL COMMENT '请求者用户ID',
    `receiver_user_id` bigint unsigned NOT NULL COMMENT '接收者用户ID',
    `source_conversation_id` bigint unsigned DEFAULT NULL COMMENT '来源群组会话ID',
    `request_message` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '请求消息',
    `request_source` enum(
        'account',
        'group',
        'search',
        'system'
    ) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'account' COMMENT '请求来源（account-账号/group-群组/search-搜索/system-系统）',
    `request_status` enum(
        'pending',
        'accepted',
        'rejected',
        'cancelled',
        'expired'
    ) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '请求状态（pending-待处理/accepted-已接受/rejected-已拒绝/cancelled-已取消/expired-已过期）',
    `handled_by_user_id` bigint unsigned DEFAULT NULL COMMENT '处理者用户ID',
    `handled_at` datetime DEFAULT NULL COMMENT '处理时间',
    `reject_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '拒绝原因',
    `expire_at` datetime DEFAULT NULL COMMENT '过期时间',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    KEY `idx_friend_requests_requester_status` (
        `requester_user_id`,
        `request_status`,
        `created_at`
    ),
    KEY `idx_friend_requests_receiver_status` (
        `receiver_user_id`,
        `request_status`,
        `created_at`
    ),
    KEY `idx_friend_requests_pair_status` (
        `requester_user_id`,
        `receiver_user_id`,
        `request_status`
    ),
    KEY `idx_friend_requests_status_expire` (`request_status`, `expire_at`),
    KEY `idx_friend_requests_source_conversation` (`source_conversation_id`),
    KEY `idx_friend_requests_handled_by` (`handled_by_user_id`),
    CONSTRAINT `fk_friend_requests_handled_by` FOREIGN KEY (`handled_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_friend_requests_receiver` FOREIGN KEY (`receiver_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_friend_requests_requester` FOREIGN KEY (`requester_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_friend_requests_source_conversation` FOREIGN KEY (`source_conversation_id`) REFERENCES `chat_conversations` (`id`) ON DELETE SET NULL,
    CONSTRAINT `chk_friend_requests_not_self` CHECK (
        (
            `requester_user_id` <> `receiver_user_id`
        )
    )
) ENGINE = InnoDB AUTO_INCREMENT = 6 DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '好友请求表';
/*!40101 SET character_set_client = @saved_cs_client */
;

--
-- Dumping data for table `user_friend_requests`
--

/*!40000 ALTER TABLE `user_friend_requests` DISABLE KEYS */
;
INSERT INTO
    `user_friend_requests`
VALUES (
        2,
        8,
        11,
        NULL,
        NULL,
        'account',
        'accepted',
        11,
        '2026-04-21 15:21:21',
        NULL,
        '2026-04-28 15:21:15',
        '2026-04-21 15:21:15',
        '2026-04-21 23:21:16'
    ),
    (
        3,
        8,
        14,
        NULL,
        NULL,
        'account',
        'accepted',
        14,
        '2026-04-21 15:42:58',
        NULL,
        '2026-04-28 15:42:51',
        '2026-04-21 15:42:51',
        '2026-04-21 23:42:51'
    ),
    (
        4,
        11,
        14,
        NULL,
        NULL,
        'account',
        'accepted',
        14,
        '2026-04-21 15:56:13',
        NULL,
        '2026-04-28 15:56:05',
        '2026-04-21 15:56:05',
        '2026-04-21 23:56:06'
    ),
    (
        5,
        11,
        7,
        NULL,
        NULL,
        'search',
        'expired',
        NULL,
        '2026-05-08 05:36:14',
        NULL,
        '2026-04-30 15:15:26',
        '2026-04-23 15:15:26',
        '2026-05-08 05:36:14'
    );
/*!40000 ALTER TABLE `user_friend_requests` ENABLE KEYS */
;

--
-- Table structure for table `user_friendships`
--

DROP TABLE IF EXISTS `user_friendships`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
CREATE TABLE `user_friendships` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
    `user_id` bigint unsigned NOT NULL COMMENT '用户ID',
    `friend_user_id` bigint unsigned NOT NULL COMMENT '好友用户ID',
    `source_request_id` bigint unsigned DEFAULT NULL COMMENT '来源好友请求ID',
    `source_conversation_id` bigint unsigned DEFAULT NULL COMMENT '来源群组会话ID',
    `status` enum('active', 'deleted') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT '好友关系状态（active-活跃/deleted-已删除）',
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
    UNIQUE KEY `ux_friendships_user_friend` (`user_id`, `friend_user_id`),
    KEY `idx_friendships_user_status` (`user_id`, `status`),
    KEY `idx_friendships_friend_status` (`friend_user_id`, `status`),
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
    CONSTRAINT `chk_friendships_not_self` CHECK (
        (`user_id` <> `friend_user_id`)
    )
) ENGINE = InnoDB AUTO_INCREMENT = 9 DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '好友关系表（按用户方向存储）';
/*!40101 SET character_set_client = @saved_cs_client */
;

--
-- Dumping data for table `user_friendships`
--

/*!40000 ALTER TABLE `user_friendships` DISABLE KEYS */
;
INSERT INTO
    `user_friendships`
VALUES (
        3,
        8,
        11,
        2,
        NULL,
        'active',
        NULL,
        0,
        0,
        '2026-04-21 15:21:21',
        11,
        NULL,
        NULL,
        '2026-04-21 15:21:21',
        '2026-04-21 23:21:21'
    ),
    (
        4,
        11,
        8,
        2,
        NULL,
        'active',
        NULL,
        0,
        0,
        '2026-04-21 15:21:21',
        11,
        NULL,
        NULL,
        '2026-04-21 15:21:21',
        '2026-04-21 23:21:21'
    ),
    (
        5,
        8,
        14,
        3,
        NULL,
        'active',
        NULL,
        0,
        0,
        '2026-04-21 15:42:58',
        14,
        NULL,
        NULL,
        '2026-04-21 15:42:58',
        '2026-04-21 23:42:58'
    ),
    (
        6,
        14,
        8,
        3,
        NULL,
        'active',
        NULL,
        0,
        0,
        '2026-04-21 15:42:58',
        14,
        NULL,
        NULL,
        '2026-04-21 15:42:58',
        '2026-04-21 23:42:58'
    ),
    (
        7,
        11,
        14,
        4,
        NULL,
        'active',
        NULL,
        0,
        0,
        '2026-04-21 15:56:13',
        14,
        NULL,
        NULL,
        '2026-04-21 15:56:13',
        '2026-04-21 23:56:13'
    ),
    (
        8,
        14,
        11,
        4,
        NULL,
        'active',
        NULL,
        0,
        0,
        '2026-04-21 15:56:13',
        14,
        NULL,
        NULL,
        '2026-04-21 15:56:13',
        '2026-04-21 23:56:13'
    );
/*!40000 ALTER TABLE `user_friendships` ENABLE KEYS */
;

--
-- Table structure for table `user_oauth_accounts`
--

DROP TABLE IF EXISTS `user_oauth_accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
CREATE TABLE `user_oauth_accounts` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    `user_id` bigint unsigned NOT NULL COMMENT '关联用户ID',
    `provider` enum('wechat', 'google', 'apple') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '第三方登录平台类型',
    `open_id` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '第三方平台open_id',
    `union_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '第三方平台union_id（可选）',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '绑定时间',
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `ux_oauth_provider_open` (`provider`, `open_id`),
    UNIQUE KEY `ux_oauth_provider_union` (`provider`, `union_id`),
    KEY `idx_oauth_user` (`user_id`),
    KEY `idx_oauth_union_id` (`union_id`),
    CONSTRAINT `fk_oauth_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE = InnoDB AUTO_INCREMENT = 8 DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '用户第三方登录账号绑定表';
/*!40101 SET character_set_client = @saved_cs_client */
;

--
-- Dumping data for table `user_oauth_accounts`
--

/*!40000 ALTER TABLE `user_oauth_accounts` DISABLE KEYS */
;
INSERT INTO
    `user_oauth_accounts`
VALUES (
        5,
        8,
        'wechat',
        'oxAij65Eh-x4RrlwDZSdG2uSTvGc',
        NULL,
        '2026-03-31 15:33:35',
        '2026-03-31 23:33:34'
    ),
    (
        6,
        11,
        'wechat',
        'oxAij6x_y5R2yx2iPF1DNEQ1TLl0',
        NULL,
        '2026-04-01 13:02:25',
        '2026-04-01 21:02:25'
    ),
    (
        7,
        7,
        'wechat',
        'oxAij6wwtKWY1a2zU8WNh-0Lko3I',
        NULL,
        '2026-04-23 14:54:42',
        '2026-04-23 22:54:41'
    );
/*!40000 ALTER TABLE `user_oauth_accounts` ENABLE KEYS */
;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */
;
/*!50503 SET character_set_client = utf8mb4 */
;
CREATE TABLE `users` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '用户邮箱（唯一）',
    `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '密码哈希（如bcrypt）',
    `nick_name` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '用户昵称',
    `avatar_key` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '头像图片URL',
    `is_deleted` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否伪删除：0正常，1已删除',
    `deleted_at` datetime DEFAULT NULL COMMENT '伪删除时间',
    `status` tinyint(1) NOT NULL DEFAULT '1' COMMENT '账户状态：1正常，0冻结',
    `role` enum('user', 'admin') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user' COMMENT '用户角色：user普通用户，admin管理员',
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
) ENGINE = InnoDB AUTO_INCREMENT = 15 DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '用户表（支持伪删除与黑名单冻结）';
/*!40101 SET character_set_client = @saved_cs_client */
;

--
-- Dumping data for table `users`
--

/*!40000 ALTER TABLE `users` DISABLE KEYS */
;
INSERT INTO
    `users`
VALUES (
        7,
        'crbcsppcc224319@163.com',
        'k29IilExDGUgSAV/JcTkNA==:cO4GCYRgud6ib6bDsuoSCTkPUk1h3iL13dVAuOczQnI=',
        '主人',
        'e58da372383b624f13b961b0ea5a80059d88c02c67a5d5e99230cb859d00e7a3',
        0,
        NULL,
        1,
        'user',
        NULL,
        NULL,
        NULL,
        '2026-01-17 07:53:39',
        '2026-04-24 23:23:53',
        'pcclovelyj',
        NULL
    ),
    (
        8,
        '2495550774@qq.com',
        '+lWNoQbzAtaZGwS3AUoTlA==:QvffIlFkcw/ehCV7QvW7S2grPw+M0n17MuQ0+kFjMpU=',
        '茶茶你怎么了',
        '56ef0ab22a368afc0cffcf322bf7ad3d55e898dd31dd9c5e62c206ea1d2ab396',
        0,
        NULL,
        1,
        'user',
        NULL,
        NULL,
        NULL,
        '2026-01-19 03:53:45',
        '2026-04-20 23:54:17',
        'lyjabcd2026-1',
        '2026-02-14 16:49:48'
    ),
    (
        11,
        'tslj7454612@163.com',
        'hn1CWfyLIRJ1acNiVuJMPQ==:27MXmnuUrzY6sudifKiZEtGeHUsbhdz1DAMObFkzoA0=',
        '腐竹炒肉拌面',
        'f056e9a096acf2cf7292ae42ba37ab98cbfbb89fb6fdd61c382675a5b6d22a51',
        0,
        NULL,
        1,
        'user',
        NULL,
        NULL,
        NULL,
        '2026-01-19 09:36:17',
        '2026-04-21 14:25:45',
        'user_2gjfaaa',
        NULL
    ),
    (
        12,
        '2376830942@qq.com',
        'XpAXgaFCmWdJluJtYOOw2A==:FloE3GfsFI4eAsmtVkXu9ebQZuUWHHoQwvYpzSc5AnI=',
        '黎宝oVO',
        NULL,
        0,
        NULL,
        1,
        'user',
        NULL,
        NULL,
        NULL,
        '2026-01-29 06:32:50',
        '2026-01-29 14:32:49',
        'Periyeli0303',
        NULL
    ),
    (
        14,
        '15683784700@163.com',
        'cnS850uMX3oTX39UXaKbxg==:oj28/rH1X1E5XHBHf4BVT85zcJTtAAnzzC4ZaQnMn+M=',
        '香杯抱茶',
        '7506deebffb1ee3ab76cb421c514ba4c449a24e0a5367507379f21e123ad5c46',
        0,
        NULL,
        1,
        'user',
        NULL,
        NULL,
        NULL,
        '2026-04-09 07:45:21',
        '2026-04-09 15:47:07',
        'user_arsttr4r',
        NULL
    );
/*!40000 ALTER TABLE `users` ENABLE KEYS */
;

--
-- Dumping routines for database 'dailycheck'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */
;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */
;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */
;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */
;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */
;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */
;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */
;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */
;

-- Dump completed on 2026-05-18 16:50:56