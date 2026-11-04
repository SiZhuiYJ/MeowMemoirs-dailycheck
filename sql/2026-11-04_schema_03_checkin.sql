-- ============================================================
-- 打卡（仅结构（不含数据））
-- 目标库：dailycheck（MySQL 8 / MariaDB 10.4+，utf8mb4）
-- 生成时间：2026-11-04 13:12:24 +0000
-- 内容：打卡计划、计划时间段、打卡记录
--
-- 【不含数据】可直接入库、分发给他人部署；真实数据备份见 sql/private/。
--
-- 表清单：
--   checkin_plans
--   checkin_plan_time_slots
--   checkins
--
-- 恢复顺序：01_user → 02_chat → 03_checkin
--   mysql -h127.0.0.1 -uroot -p < 2026-11-04_schema_03_checkin.sql
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
DROP TABLE IF EXISTS `checkin_plans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `checkin_plans` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` bigint(20) unsigned NOT NULL COMMENT '计划所属用户ID',
  `title` varchar(255) NOT NULL COMMENT '打卡计划标题',
  `description` text DEFAULT NULL COMMENT '打卡计划描述',
  `start_date` date NOT NULL COMMENT '计划开始日期',
  `end_date` date DEFAULT NULL COMMENT '计划结束日期（可选）',
  `is_active` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否启用：1启用，0停用',
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否伪删除：0正常，1已删除',
  `deleted_at` datetime DEFAULT NULL COMMENT '伪删除时间',
  `created_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() COMMENT '更新时间',
  `checkin_mode` tinyint(3) unsigned NOT NULL DEFAULT 0 COMMENT '打卡模式：0-默认模式，1-时间段打卡模式',
  PRIMARY KEY (`id`),
  KEY `idx_plans_user` (`user_id`),
  KEY `idx_plans_start_date` (`start_date`),
  KEY `idx_plans_is_active` (`is_active`),
  KEY `idx_plans_is_deleted` (`is_deleted`),
  KEY `idx_plans_user_deleted_start` (`user_id`,`is_deleted`,`start_date`),
  CONSTRAINT `fk_plans_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=43 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='打卡计划表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `checkin_plan_time_slots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `checkin_plan_time_slots` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `plan_id` bigint(20) unsigned NOT NULL COMMENT '所属打卡计划ID',
  `slot_name` varchar(64) DEFAULT NULL COMMENT '时间段名称，如“早晨”、“下午”',
  `start_time` time NOT NULL COMMENT '开始时间（如 09:00:00）',
  `end_time` time NOT NULL COMMENT '结束时间（如 10:00:00）',
  `order_num` smallint(5) unsigned NOT NULL DEFAULT 0 COMMENT '排序序号，用于界面展示顺序',
  `is_active` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否启用：1启用，0停用',
  `created_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_slots_plan` (`plan_id`),
  KEY `idx_slots_active` (`is_active`),
  KEY `idx_slots_plan_active_order` (`plan_id`,`is_active`,`order_num`,`start_time`),
  CONSTRAINT `fk_slots_plan` FOREIGN KEY (`plan_id`) REFERENCES `checkin_plans` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=28 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='打卡计划时间段配置表（每日重复）';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `checkins`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `checkins` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `plan_id` bigint(20) unsigned NOT NULL COMMENT '所属打卡计划ID',
  `time_slot_id` bigint(20) unsigned DEFAULT NULL COMMENT '关联的打卡时间段ID',
  `user_id` bigint(20) unsigned NOT NULL COMMENT '打卡用户ID',
  `check_date` date NOT NULL COMMENT '打卡日期（仅日期）',
  `images` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT '打卡图片URL数组(JSON)' CHECK (json_valid(`images`)),
  `note` text DEFAULT NULL COMMENT '打卡备注',
  `status` tinyint(4) NOT NULL COMMENT '打卡状态：0错过(红)、1成功(绿)、2补签(黄)',
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否伪删除：0正常，1已删除',
  `deleted_at` datetime DEFAULT NULL COMMENT '伪删除时间',
  `created_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() COMMENT '更新时间',
  `time_slot_id_key` bigint(20) unsigned GENERATED ALWAYS AS (coalesce(`time_slot_id`,0)) STORED COMMENT 'Normalized time_slot_id for uniqueness',
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_checkins_plan_date_slot` (`plan_id`,`check_date`,`time_slot_id`),
  UNIQUE KEY `ux_checkins_plan_date_slot_key` (`plan_id`,`check_date`,`time_slot_id_key`),
  KEY `idx_checkins_user_date` (`user_id`,`check_date`),
  KEY `idx_checkins_status` (`status`),
  KEY `idx_checkins_is_deleted` (`is_deleted`),
  KEY `fk_checkins_time_slot` (`time_slot_id`),
  KEY `idx_checkins_plan_deleted_date_slot` (`plan_id`,`is_deleted`,`check_date`,`time_slot_id`),
  CONSTRAINT `fk_checkins_plan` FOREIGN KEY (`plan_id`) REFERENCES `checkin_plans` (`id`),
  CONSTRAINT `fk_checkins_time_slot` FOREIGN KEY (`time_slot_id`) REFERENCES `checkin_plan_time_slots` (`id`),
  CONSTRAINT `fk_checkins_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=165 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='打卡记录表';
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
-- 结束：2026-11-04_schema_03_checkin.sql
