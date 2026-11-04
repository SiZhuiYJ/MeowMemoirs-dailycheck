-- MySQL dump 10.13  Distrib 8.0.33, for Win64 (x86_64)
--
-- Host: 8.137.127.7    Database: rainbow_database
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
-- Table structure for table `blacklist`
--

DROP TABLE IF EXISTS `blacklist`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `blacklist` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '黑名单ID',
  `blacklist_type` enum('token','user','ip') NOT NULL COMMENT '类型:token/user/ip',
  `blacklist_value` varchar(255) NOT NULL COMMENT '具体值',
  `reason` varchar(200) DEFAULT NULL COMMENT '加入原因',
  `expire_time` datetime DEFAULT NULL COMMENT '过期时间',
  `admin_id` bigint unsigned DEFAULT NULL COMMENT '操作管理员ID',
  `is_deleted` tinyint NOT NULL DEFAULT '0' COMMENT '0-正常 1-删除',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `ext_attr1` varchar(255) DEFAULT NULL COMMENT '扩展字段1',
  `ext_attr2` varchar(255) DEFAULT NULL COMMENT '扩展字段2',
  `ext_attr3` varchar(255) DEFAULT NULL COMMENT '扩展字段3',
  PRIMARY KEY (`id`),
  UNIQUE KEY `udx_type_value` (`blacklist_type`,`blacklist_value`),
  KEY `idx_expire_time` (`expire_time`),
  KEY `idx_admin_id` (`admin_id`),
  KEY `idx_blacklist_management` (`is_deleted`,`blacklist_type`,`expire_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='系统黑名单表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `blog_tag`
--

DROP TABLE IF EXISTS `blog_tag`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `blog_tag` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '标签ID',
  `user_id` bigint unsigned NOT NULL COMMENT '创建者ID',
  `tag_name` varchar(20) NOT NULL COMMENT '标签名称',
  `tag_color` varchar(7) NOT NULL COMMENT '标签颜色',
  `tag_icon` varchar(100) NOT NULL COMMENT '标签图标',
  `tag_description` varchar(200) NOT NULL COMMENT '标签描述',
  `tag_status` tinyint NOT NULL DEFAULT '1' COMMENT '0-禁用 1-启用',
  `is_deleted` tinyint NOT NULL DEFAULT '0' COMMENT '0-正常 1-删除',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `ext_attr1` varchar(255) DEFAULT NULL COMMENT '扩展字段1',
  `ext_attr2` varchar(255) DEFAULT NULL COMMENT '扩展字段2',
  `ext_attr3` varchar(255) DEFAULT NULL COMMENT '扩展字段3',
  PRIMARY KEY (`id`),
  UNIQUE KEY `udx_tag_name` (`tag_name`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_tag_status` (`tag_status`),
  KEY `idx_tag_global_status` (`is_deleted`,`tag_status`),
  CONSTRAINT `fk_blog_tag_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=10008 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='博客标签表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `blogs`
--

DROP TABLE IF EXISTS `blogs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `blogs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '博客ID',
  `user_id` bigint unsigned NOT NULL COMMENT '用户ID',
  `title` varchar(255) NOT NULL COMMENT '博客标题',
  `summary` varchar(100) DEFAULT NULL COMMENT '博客摘要内容',
  `content` text NOT NULL COMMENT '博客内容',
  `tags` json NOT NULL COMMENT '博客标签(JSON格式)',
  `view_count` int unsigned NOT NULL DEFAULT '0' COMMENT '浏览量',
  `like_count` int unsigned NOT NULL DEFAULT '0' COMMENT '点赞数',
  `is_deleted` tinyint NOT NULL DEFAULT '0' COMMENT '0-正常 1-删除',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `ext_attr1` varchar(255) DEFAULT NULL COMMENT '扩展字段1',
  `ext_attr2` varchar(255) DEFAULT NULL COMMENT '扩展字段2',
  `ext_attr3` varchar(255) DEFAULT NULL COMMENT '扩展字段3',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_blog_status` (`is_deleted`,`create_time`),
  FULLTEXT KEY `ft_title_content` (`title`,`content`),
  CONSTRAINT `fk_blog_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='博客表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `class`
--

DROP TABLE IF EXISTS `class`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `class` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '课程ID',
  `user_id` bigint unsigned NOT NULL COMMENT '用户ID',
  `class_name` varchar(255) NOT NULL COMMENT '课程名',
  `location` varchar(255) NOT NULL COMMENT '地点',
  `day_of_week` tinyint unsigned NOT NULL COMMENT '周几(1-7)',
  `week_list` json NOT NULL COMMENT '周数(JSON数组)',
  `session_list` json NOT NULL COMMENT '节次(JSON数组)',
  `teacher` varchar(255) NOT NULL COMMENT '教师',
  `color` varchar(7) NOT NULL DEFAULT '#1890ff' COMMENT '颜色',
  `remark` text COMMENT '备注',
  `is_deleted` tinyint NOT NULL DEFAULT '0' COMMENT '0-正常 1-删除',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `ext_attr1` varchar(255) DEFAULT NULL COMMENT '扩展字段1',
  `ext_attr2` varchar(255) DEFAULT NULL COMMENT '扩展字段2',
  `ext_attr3` varchar(255) DEFAULT NULL COMMENT '扩展字段3',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_day_of_week` (`day_of_week`),
  KEY `idx_class_status` (`is_deleted`,`day_of_week`),
  CONSTRAINT `fk_class_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_day_of_week` CHECK ((`day_of_week` between 1 and 7))
) ENGINE=InnoDB AUTO_INCREMENT=70 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='课程表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `clockinrecords`
--

DROP TABLE IF EXISTS `clockinrecords`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `clockinrecords` (
  `Id` int NOT NULL AUTO_INCREMENT COMMENT '记录ID',
  `ScheduleId` int NOT NULL COMMENT '计划ID',
  `Date` date NOT NULL COMMENT '打卡日期（UTC）',
  `ImageUrl` varchar(512) DEFAULT NULL COMMENT '图片链接',
  `Note` text COMMENT '备注',
  `Status` tinyint NOT NULL COMMENT '状态 0=错过, 1=当日, 2=补打',
  `CreatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`Id`),
  KEY `ScheduleId` (`ScheduleId`),
  CONSTRAINT `clockinrecords_ibfk_1` FOREIGN KEY (`ScheduleId`) REFERENCES `clockinschedules` (`Id`)
) ENGINE=InnoDB AUTO_INCREMENT=10008 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='打卡记录表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `clockinschedules`
--

DROP TABLE IF EXISTS `clockinschedules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `clockinschedules` (
  `Id` int NOT NULL AUTO_INCREMENT COMMENT '计划ID',
  `UserId` int NOT NULL COMMENT '用户ID',
  `Title` varchar(255) NOT NULL COMMENT '计划标题',
  `StartDate` date NOT NULL COMMENT '开始日期',
  `EndDate` date NOT NULL COMMENT '结束日期',
  `StartTime` time NOT NULL COMMENT '开始时间',
  `EndTime` time NOT NULL COMMENT '结束时间',
  PRIMARY KEY (`Id`),
  KEY `UserId` (`UserId`),
  CONSTRAINT `clockinschedules_ibfk_1` FOREIGN KEY (`UserId`) REFERENCES `clockinusers` (`Id`)
) ENGINE=InnoDB AUTO_INCREMENT=10008 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='打卡计划表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `clockinusers`
--

DROP TABLE IF EXISTS `clockinusers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `clockinusers` (
  `Id` int NOT NULL AUTO_INCREMENT COMMENT '用户ID',
  `Email` varchar(255) NOT NULL COMMENT '邮箱',
  `PasswordHash` varchar(255) NOT NULL COMMENT '密码哈希',
  `IsVerified` tinyint(1) DEFAULT '0' COMMENT '是否已验证',
  `CreatedAt` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`Id`),
  UNIQUE KEY `Email` (`Email`)
) ENGINE=InnoDB AUTO_INCREMENT=10008 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `course`
--

DROP TABLE IF EXISTS `course`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `course` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '课程表ID',
  `schedule_id` bigint unsigned NOT NULL COMMENT '课表ID',
  `course_name` varchar(255) NOT NULL COMMENT '课程名',
  `color` varchar(7) NOT NULL COMMENT '课程颜色',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `remark` text COMMENT '备注',
  `is_deleted` tinyint NOT NULL DEFAULT '0' COMMENT '0-正常 1-删除',
  `ext_attr1` varchar(255) DEFAULT NULL COMMENT '扩展字段1',
  `ext_attr2` varchar(255) DEFAULT NULL COMMENT '扩展字段2',
  `ext_attr3` varchar(255) DEFAULT NULL COMMENT '扩展字段3',
  PRIMARY KEY (`id`),
  KEY `idx_schedule_id` (`schedule_id`),
  KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='课程详情表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `course_time`
--

DROP TABLE IF EXISTS `course_time`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `course_time` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '课程时间段 ID',
  `course_id` bigint unsigned NOT NULL COMMENT '课程表 ID',
  `location` varchar(100) NOT NULL COMMENT '课程地点',
  `teacher` varchar(50) NOT NULL COMMENT '教师姓名',
  `week_list` json NOT NULL COMMENT '周次列表，如 [1,2,3]',
  `section_list` json NOT NULL COMMENT '节次列表，如 [1,2,3]',
  `day_of_week` tinyint unsigned NOT NULL COMMENT '周几，1-7',
  `remark` text COMMENT '备注',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `is_deleted` tinyint NOT NULL DEFAULT '0' COMMENT '0-正常 1-删除',
  PRIMARY KEY (`id`),
  KEY `idx_course_id` (`course_id`),
  KEY `idx_teacher` (`teacher`),
  KEY `idx_location` (`location`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='课程时间段表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ip_access_log`
--

DROP TABLE IF EXISTS `ip_access_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ip_access_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `ip_id` varchar(64) GENERATED ALWAYS AS (sha2(concat(`ip_address`,`request_time`),256)) STORED COMMENT 'IP和时间戳哈希值',
  `ip_address` varchar(45) NOT NULL COMMENT '客户端IP地址',
  `user_agent` text COMMENT '客户端浏览器信息',
  `request_body` text COMMENT '请求体内容(脱敏)',
  `request_time` datetime(3) NOT NULL COMMENT '请求时间(毫秒)',
  `request_method` varchar(10) NOT NULL COMMENT 'HTTP请求方法',
  `request_url` varchar(2048) NOT NULL COMMENT '完整请求路径',
  `http_version` varchar(20) DEFAULT NULL COMMENT 'HTTP协议版本',
  `response_status` int DEFAULT NULL COMMENT '响应状态码',
  `response_time_ms` int unsigned DEFAULT NULL COMMENT '处理耗时(毫秒)',
  `referer` varchar(2048) DEFAULT NULL COMMENT '来源页面URL',
  `headers` json DEFAULT NULL COMMENT '请求头信息(JSON)',
  `geo_location` json DEFAULT NULL COMMENT 'IP地理位置(JSON)',
  `device_type` varchar(20) DEFAULT NULL COMMENT '设备类型',
  `os_name` varchar(50) DEFAULT NULL COMMENT '操作系统',
  `browser_name` varchar(50) DEFAULT NULL COMMENT '浏览器',
  `is_bot` tinyint NOT NULL DEFAULT '0' COMMENT '0-正常 1-爬虫',
  `threat_level` tinyint unsigned NOT NULL DEFAULT '0' COMMENT '威胁等级0-5',
  `session_id` varchar(128) DEFAULT NULL COMMENT '用户会话ID',
  `user_id` varchar(64) DEFAULT NULL COMMENT '关联用户ID',
  `extra_notes` text COMMENT '备注信息',
  `is_deleted` tinyint NOT NULL DEFAULT '0' COMMENT '0-正常 1-删除',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `ext_attr1` varchar(255) DEFAULT NULL COMMENT '扩展字段1',
  `ext_attr2` varchar(255) DEFAULT NULL COMMENT '扩展字段2',
  `ext_attr3` varchar(255) DEFAULT NULL COMMENT '扩展字段3',
  PRIMARY KEY (`id`),
  KEY `idx_ip_address` (`ip_address`),
  KEY `idx_request_time` (`request_time`),
  KEY `idx_response_status` (`response_status`),
  KEY `idx_threat_level` (`threat_level`),
  KEY `idx_access_analysis` (`ip_address`,`request_time`,`response_status`),
  KEY `idx_log_status` (`is_deleted`,`threat_level`)
) ENGINE=InnoDB AUTO_INCREMENT=1651 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='IP访问记录表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `login_session`
--

DROP TABLE IF EXISTS `login_session`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `login_session` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '会话ID',
  `user_id` bigint unsigned NOT NULL COMMENT '用户ID',
  `access_token` varchar(500) NOT NULL COMMENT '访问令牌',
  `refresh_token` varchar(500) NOT NULL COMMENT '刷新令牌',
  `expire_time` datetime NOT NULL COMMENT '令牌到期时间',
  `device_info` varchar(200) DEFAULT NULL COMMENT '设备信息',
  `ip_address` varchar(50) DEFAULT NULL COMMENT '登录IP地址',
  `is_deleted` tinyint NOT NULL DEFAULT '0' COMMENT '0-正常 1-删除',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后活动时间',
  `ext_attr1` varchar(255) DEFAULT NULL COMMENT '扩展字段1',
  `ext_attr2` varchar(255) DEFAULT NULL COMMENT '扩展字段2',
  `ext_attr3` varchar(255) DEFAULT NULL COMMENT '扩展字段3',
  PRIMARY KEY (`id`),
  UNIQUE KEY `udx_refresh_token` (`refresh_token`(255)),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_expire_time` (`expire_time`),
  KEY `idx_access_token` (`access_token`(255)),
  KEY `idx_session_cleanup` (`is_deleted`,`expire_time`),
  CONSTRAINT `fk_login_session_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=361 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户登录会话表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `schedule`
--

DROP TABLE IF EXISTS `schedule`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `schedule` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '课表ID',
  `user_id` bigint unsigned NOT NULL COMMENT '用户ID',
  `schedule_name` varchar(255) NOT NULL COMMENT '课程名',
  `start_time` varchar(20) NOT NULL COMMENT '开课时间',
  `week_count` int NOT NULL COMMENT '本学期周数',
  `timetable` json NOT NULL COMMENT '作息表',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `remark` text COMMENT '备注',
  `is_deleted` tinyint NOT NULL DEFAULT '0' COMMENT '0-正常 1-删除',
  `ext_attr1` varchar(255) DEFAULT NULL COMMENT '扩展字段1',
  `ext_attr2` varchar(255) DEFAULT NULL COMMENT '扩展字段2',
  `ext_attr3` varchar(255) DEFAULT NULL COMMENT '扩展字段3',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='课表主表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user`
--

DROP TABLE IF EXISTS `user`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '用户ID',
  `rainbow_id` varchar(20) NOT NULL DEFAULT 'rainbow_001' COMMENT 'RainbowID',
  `user_name` varchar(20) NOT NULL DEFAULT 'rainbow_user' COMMENT '用户名',
  `user_password` varchar(255) NOT NULL COMMENT '密码(加密存储)',
  `user_phone` char(11) DEFAULT NULL COMMENT '手机号',
  `user_email` varchar(30) NOT NULL COMMENT '邮箱',
  `user_img` varchar(100) DEFAULT 'default_avatar.jpg' COMMENT '头像',
  `permission_level` varchar(10) NOT NULL DEFAULT 'v1' COMMENT '权限等级: v1-普通用户 admin-管理员',
  `security_question` varchar(200) DEFAULT NULL COMMENT '密保问题',
  `security_answer` varchar(200) DEFAULT NULL COMMENT '密保答案',
  `is_deleted` tinyint NOT NULL DEFAULT '0' COMMENT '0-正常 1-删除',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `ext_attr1` varchar(255) DEFAULT NULL COMMENT '扩展字段1',
  `ext_attr2` varchar(255) DEFAULT NULL COMMENT '扩展字段2',
  `ext_attr3` varchar(255) DEFAULT NULL COMMENT '扩展字段3',
  PRIMARY KEY (`id`),
  UNIQUE KEY `udx_rainbow_id` (`rainbow_id`),
  UNIQUE KEY `udx_user_name` (`user_name`),
  UNIQUE KEY `udx_user_email` (`user_email`),
  KEY `idx_permission_level` (`permission_level`),
  KEY `idx_user_status` (`is_deleted`,`permission_level`) COMMENT '复合状态索引'
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_profile`
--

DROP TABLE IF EXISTS `user_profile`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_profile` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '用户资料ID',
  `user_id` bigint unsigned NOT NULL COMMENT '用户ID',
  `birthday` date DEFAULT '2024-04-30' COMMENT '生日',
  `gender` tinyint NOT NULL DEFAULT '2' COMMENT '0-女 1-男 2-未知',
  `longitude` decimal(10,7) DEFAULT NULL COMMENT '用户经度',
  `latitude` decimal(10,7) DEFAULT NULL COMMENT '用户纬度',
  `address` varchar(200) DEFAULT NULL COMMENT '用户地址',
  `is_deleted` tinyint NOT NULL DEFAULT '0' COMMENT '0-正常 1-删除',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `ext_attr1` varchar(255) DEFAULT NULL COMMENT '扩展字段1',
  `ext_attr2` varchar(255) DEFAULT NULL COMMENT '扩展字段2',
  `ext_attr3` varchar(255) DEFAULT NULL COMMENT '扩展字段3',
  PRIMARY KEY (`id`),
  UNIQUE KEY `udx_user_id` (`user_id`),
  KEY `idx_gender` (`gender`),
  KEY `idx_profile_status` (`is_deleted`,`gender`),
  CONSTRAINT `fk_user_profile_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_gender` CHECK ((`gender` in (0,1,2)))
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户资料表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping routines for database 'rainbow_database'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-18 16:53:27
