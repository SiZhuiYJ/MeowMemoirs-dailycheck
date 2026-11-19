-- ============================================================
-- 课表模块建表脚本（Schedule / Course / CourseTime）
--
-- 来源：原 MeowMemoirs 课表项目的 schedule / course / course_time 结构，
-- 迁移进 DaisyCheck 后端时统一改用项目现有命名/时间字段风格：
--   · 主键 id bigint unsigned
--   · 伪删除 is_deleted tinyint
--   · created_at / updated_at datetime
--   · 字符集 utf8mb4 / utf8mb4_unicode_ci（MariaDB 兼容）
--
-- 幂等：可重复执行（CREATE TABLE IF NOT EXISTS）。
-- 执行：mariadb -u root -p"$(cat ~/.config/notebook/db_password)" dailycheck < sql/2026-11-19_schedule_schema.sql
-- ============================================================

USE `dailycheck`;

-- 课表
CREATE TABLE IF NOT EXISTS `schedules` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '课表ID',
    `user_id` bigint unsigned NOT NULL COMMENT '所属用户ID',
    `schedule_name` varchar(100) NOT NULL COMMENT '课表名称（如：2026春季学期）',
    `start_time` date NOT NULL COMMENT '开课日期（学期第一周周一）',
    `week_count` int unsigned NOT NULL DEFAULT 20 COMMENT '学期总周数',
    `timetable` json NOT NULL COMMENT '作息时间表（JSON 数组，每节一项，如 ["08:00-08:45"]）',
    `remark` text DEFAULT NULL COMMENT '备注',
    `is_deleted` tinyint NOT NULL DEFAULT 0 COMMENT '0-正常 1-删除',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    KEY `idx_schedules_user` (`user_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '课表';

-- 课程（课表下的课程）
CREATE TABLE IF NOT EXISTS `courses` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '课程ID',
    `schedule_id` bigint unsigned NOT NULL COMMENT '所属课表ID',
    `course_name` varchar(100) NOT NULL COMMENT '课程名称',
    `color` varchar(16) NOT NULL DEFAULT '#9b4f93' COMMENT '课程颜色',
    `remark` text DEFAULT NULL COMMENT '备注',
    `is_deleted` tinyint NOT NULL DEFAULT 0 COMMENT '0-正常 1-删除',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    KEY `idx_courses_schedule` (`schedule_id`),
    KEY `idx_courses_schedule_deleted` (`schedule_id`, `is_deleted`),
    CONSTRAINT `fk_courses_schedule` FOREIGN KEY (`schedule_id`) REFERENCES `schedules` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '课表下的课程';

-- 课程时间段（一门课可以有多段）
CREATE TABLE IF NOT EXISTS `course_times` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '课程时间段ID',
    `course_id` bigint unsigned NOT NULL COMMENT '所属课程ID',
    `location` varchar(255) NOT NULL COMMENT '上课地点',
    `teacher` varchar(100) NOT NULL COMMENT '任课教师',
    `week_list` json NOT NULL COMMENT '周次列表（JSON 数组，如 [1,2,3]）',
    `section_list` json NOT NULL COMMENT '节次列表（JSON 数组，如 [1,2]）',
    `day_of_week` tinyint unsigned NOT NULL COMMENT '星期几（1-7，周一到周日）',
    `remark` text DEFAULT NULL COMMENT '备注',
    `is_deleted` tinyint NOT NULL DEFAULT 0 COMMENT '0-正常 1-删除',
    `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    KEY `idx_course_times_course` (`course_id`),
    KEY `idx_course_times_course_deleted` (`course_id`, `is_deleted`),
    KEY `idx_course_times_day` (`day_of_week`),
    CONSTRAINT `fk_course_times_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '课程时间段';
