# sql/legacy — 历史导出存档

本目录只存放 2026-05 期间从旧环境导出的 SQL，**已与当前代码结构脱节**，不要用它们初始化数据库。
当前可用的建表脚本在上一层：`sql/2026-11-04_schema_01_user.sql`、`_02_chat.sql`、`_03_checkin.sql`。

| 文件 | 说明 |
| --- | --- |
| `dailycheck_2026-05-18_165044.sql` | 早期 dailycheck 库全量导出 |
| `dailycheck_2026-05-18_170653.sql` | 同上，后续一次导出 |
| `dailycheck_2026-05-18_192444.sql` | 同上，后续一次导出 |
| `dailycheck_2026-05-19_140753（本地化更新）.sql` | 引入本地化的那次导出，曾长期作为 README 的初始化脚本 |
| `dailycheck_optimization_2026-05-18.sql` | 索引/字段优化脚本 |
| `rainbow_database_2026-05-18_165252.sql` | 另一个库 `rainbow_database` 的全量导出（截图/图床相关） |
| `rainbow_database_2026-05-18_165319.sql` | 同上，后续一次导出 |

## 注意事项

这些文件由 **MySQL 8** 导出，导入 MariaDB 前需要：

1. 全文替换 `utf8mb4_0900_ai_ci` → `utf8mb4_unicode_ci`（MariaDB 不支持前者）；
2. 删除 `SET @@GLOBAL.GTID_PURGED=...` 一行（MariaDB 无此变量）。

## 与当前库的差异（考古时参考）

- 表名体系不同：旧导出用 `user` / `clockinrecords` / `course` 等，现已统一为 `users` / `checkin_*` / `chat_*`。
- 缺少 `user_blocks`、`chat_message_deletions`、`chat_group_join_requests` 等后来新增的表。
- 缺少 `recalled_by_user_id`、`recall_prompt`、`is_hidden`、`history_cleared_*` 等后来新增的列。
