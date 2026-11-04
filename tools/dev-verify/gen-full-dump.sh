#!/data/data/com.termux/files/usr/bin/bash
# 生成 three-file 全量备份（结构 + 数据），按业务域拆分。
# 用法：bash tools/dev-verify/gen-full-dump.sh
set -euo pipefail

DB=dailycheck
OUT_DIR="$(cd "$(dirname "$0")/../.." && pwd)/sql"
STAMP=$(date +%Y-%m-%d)

# —— 凭据来源（不写死在脚本里，避免随仓库公开）——
#   1) 环境变量 DB_CONNECTION（ADO.NET 连接串，优先级最高）
#   2) api/appsettings.Development.json 里的 ConnectionStrings:Default（该文件已被 .gitignore 忽略）
CONN_STR="${DB_CONNECTION:-}"
if [ -z "$CONN_STR" ] && [ -f "$OUT_DIR/../api/appsettings.Development.json" ]; then
  CONN_STR=$(sed -n 's/.*"Default"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    "$OUT_DIR/../api/appsettings.Development.json" | head -1)
fi
if [ -z "$CONN_STR" ]; then
  echo "找不到数据库连接串：请设置 DB_CONNECTION 或提供 api/appsettings.Development.json" >&2
  exit 1
fi

conn_part() {
  printf '%s' "$CONN_STR" | tr ';' '\n' | sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" | head -1
}

HOST="$(conn_part server)"; HOST="${HOST:-127.0.0.1}"
PORT="$(conn_part port)";   PORT="${PORT:-3306}"
USER="$(conn_part uid)";    USER="${USER:-$(conn_part user)}"; USER="${USER:-root}"
DB="$(conn_part database)"; DB="${DB:-dailycheck}"

# 用 MYSQL_PWD 传密码，避免出现在 ps 的命令行里
if [ -n "$(conn_part pwd)" ]; then
  export MYSQL_PWD="$(conn_part pwd)"
fi

# 默认关闭 TLS：本机回环连接，同时消除客户端的 ssl-verify 告警。
# 若要连远端加密库，把下面两处 --ssl=0 去掉或改成 --ssl。
MYSQL=(mariadb --protocol=TCP --ssl=0 -h"$HOST" -P"$PORT" -u"$USER")
DUMP=(mariadb-dump --protocol=TCP --ssl=0 -h"$HOST" -P"$PORT" -u"$USER"
  --default-character-set=utf8mb4
  --single-transaction
  --quick
  --complete-insert
  --hex-blob
  --add-drop-table
  --skip-comments
  --no-tablespaces)

# 两组输出：
#   1) sql/<日期>_schema_XX_*.sql —— 仅结构，进仓库（无任何用户数据）
#   2) sql/private/<日期>_full_XX_*.sql —— 结构 + 数据，含真实邮箱/密码哈希/聊天正文，
#      已被 .gitignore 忽略，只留本地做备份
PRIVATE_DIR="$OUT_DIR/private"
mkdir -p "$PRIVATE_DIR"

declare -a GROUP_FILES=(
  "01_user|用户与账号|用户主表、第三方登录、好友关系/申请、拉黑、行为日志|users user_oauth_accounts user_friendships user_friend_requests user_blocks user_blacklist_records soft_delete_logs user_activity __efmigrationshistory"
  "02_chat|聊天与群聊|会话、成员、消息、回执、伪删除、文件记录、群申请与操作日志|chat_conversations chat_conversation_members chat_messages chat_message_receipts chat_message_deletions chat_file_records chat_group_join_requests chat_group_action_logs"
  "03_checkin|打卡|打卡计划、计划时间段、打卡记录|checkin_plans checkin_plan_time_slots checkins"
)

render() {
  # $1=文件名 $2=标题 $3=描述 $4=表列表 $5=是否含数据(yes/no)
  local filename="$1" title="$2" desc="$3" tables="$4" with_data="$5"
  local kind="仅结构（不含数据）"
  [ "$with_data" = "yes" ] && kind="全量（结构 + 数据）"

  echo "-- ============================================================"
  echo "-- $title（$kind）"
  echo "-- 目标库：$DB（MySQL 8 / MariaDB 10.4+，utf8mb4）"
  echo "-- 生成时间：$(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "-- 内容：$desc"
  echo "--"
  if [ "$with_data" = "yes" ]; then
    echo "-- 【含真实用户数据】邮箱、密码哈希、聊天正文等，仅限本地保存，勿提交到公开仓库。"
  else
    echo "-- 【不含数据】可直接入库、分发给他人部署；真实数据备份见 sql/private/。"
  fi
  echo "--"
  echo "-- 表清单："
  for t in $tables; do
    if [ "$with_data" = "yes" ]; then
      local n
      n=$("${MYSQL[@]}" -N -e "SELECT COUNT(*) FROM \`$DB\`.\`$t\`;" 2>/dev/null)
      echo "--   $t ($n 行)"
    else
      echo "--   $t"
    fi
  done
  echo "--"
  echo "-- 恢复顺序：01_user → 02_chat → 03_checkin"
  echo "--   mysql -h127.0.0.1 -uroot -p < $filename"
  echo "-- 均自带 CREATE DATABASE IF NOT EXISTS 与 FOREIGN_KEY_CHECKS 开关，"
  echo "-- 可整组重放，也可单独重放（单独重放 02/03 前请确保 01 已导入，否则外键会失败）。"
  echo "-- ============================================================"
  echo
  echo "SET NAMES utf8mb4;"
  echo "SET FOREIGN_KEY_CHECKS = 0;"
  echo "SET UNIQUE_CHECKS = 0;"
  echo "SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';"
  echo
  echo "CREATE DATABASE IF NOT EXISTS \`$DB\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  echo "USE \`$DB\`;"
  echo
  local extra=()
  [ "$with_data" = "no" ] && extra=(--no-data)
  "${DUMP[@]}" --skip-dump-date "${extra[@]}" "$DB" $tables
  echo
  echo "SET FOREIGN_KEY_CHECKS = 1;"
  echo "SET UNIQUE_CHECKS = 1;"
  echo "-- 结束：$filename"
}

for spec in "${GROUP_FILES[@]}"; do
  IFS='|' read -r key title desc tables <<< "$spec"

  schema_file="${STAMP}_schema_${key}.sql"
  render "$schema_file" "$title" "$desc" "$tables" "no" > "$OUT_DIR/$schema_file"

  full_file="${STAMP}_full_${key}.sql"
  render "$full_file" "$title" "$desc" "$tables" "yes" > "$PRIVATE_DIR/$full_file"

  printf '%-42s %7s   %s\n' "$schema_file" "$(du -h "$OUT_DIR/$schema_file" | cut -f1)" "（sql/，进仓库）"
  printf '%-42s %7s   %s\n' "private/$full_file" "$(du -h "$PRIVATE_DIR/$full_file" | cut -f1)" "（本地备份，已忽略）"
done
