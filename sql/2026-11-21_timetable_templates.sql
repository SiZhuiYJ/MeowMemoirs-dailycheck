-- ============================================================
-- 作息表模板（timetable_templates）
-- 目标库：dailycheck（MySQL 8 / MariaDB 10.4+，utf8mb4）
-- 日期：2026-11-21
--
-- 变更内容：
--   新增 timetable_templates：保存用户可复用的作息时间表（如「标准 12 节」「夏季作息」），
--   导入课表 / 新建课表时可直接套用；从已有课表提取的历史作息不落这张表，由接口现算。
--   表由 api/Data/TimetableTemplate.cs + api/Data/DailyCheckDbContext.Schedule.cs 映射使用。
--
-- 说明：
--   · 可在已初始化的库上**重复执行**（CREATE TABLE IF NOT EXISTS，不会动既有数据）。
--   · times 为 JSON 数组（第 1 节开始，每项 "HH:mm-HH:mm"，如 ["08:00-08:45", ...]）。
--   · 执行：mariadb -u root -p dailycheck < sql/2026-11-21_timetable_templates.sql
-- ============================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `timetable_templates` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` bigint(20) unsigned NOT NULL COMMENT '所属用户ID',
  `name` varchar(100) NOT NULL COMMENT '作息表名称',
  `times` json NOT NULL COMMENT '作息时间（JSON 数组，第1节开始）',
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否伪删除：0正常，1已删除',
  `created_at` datetime NOT NULL DEFAULT current_timestamp() COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_timetable_templates_user` (`user_id`,`is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='作息表模板';

-- ============================================================
-- 回滚（如需）：
-- DROP TABLE IF EXISTS `timetable_templates`;
-- ============================================================
