-- ============================================================
-- 用户登录记录表（user_login_records）
-- 目标库：dailycheck（MySQL 8 / MariaDB 10.4+，utf8mb4）
-- 日期：2026-11-18
--
-- 变更内容：
--   新增 user_login_records：小程序「登录记录」页（/pages/settings/login-records）
--   的数据来源。每次**成功登录**写一条（IP / 设备 / User-Agent / 登录方式 /
--   GeoCN 离线解析出的国内省市区），登出或被撤销时回填 logout_at。
--   表快照已同步到 sql/2026-11-04_schema_01_user.sql（user_activity 之后）。
--
-- 说明：
--   · 该表由后端 api/Data/UserLoginRecord.cs + DailyCheckDbContext 映射使用。
--   · 本脚本可在已初始化的库上**重复执行**（CREATE TABLE IF NOT EXISTS，
--     不会 DROP 或清空既有数据）。
--   · 时间统一存 UTC（库会话 SET TIME_ZONE='+00:00'，代码 DateTime.UtcNow）。
--   · 执行：mariadb -u root -p dailycheck < sql/2026-11-18_user_login_records.sql
-- ============================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `user_login_records` (
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

-- ============================================================
-- 回滚（如需）：
-- DROP TABLE IF EXISTS `user_login_records`;
-- ============================================================
