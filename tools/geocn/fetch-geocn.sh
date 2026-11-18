#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# 拉取 GeoCN「中国大陆 IP → 行政区划」离线库
#
# 用途：登录记录页（pages/settings/login-records）把登录 IP 解析成
#       国内省市（例如「河南 · 郑州」），非中国大陆 IP 一律记为境外。
#
# 产物（写入 api/Resources/ipTo/，随 build 复制到输出目录）：
#   · GeoCN.mmdb  8.7MB 二进制，体积大 → .gitignore 忽略，用本脚本拉取
#   · full.txt    「省市区全名」映射表（约 65KB，随仓库提交）
#   · short.txt   「省市区简称」映射表（约 56KB，随仓库提交）
#
# 数据来源：https://github.com/ljxi/GeoCN
#   · GeoCN.mmdb 来自 releases/latest/download/GeoCN.mmdb
#   · full.txt / short.txt 来自仓库 main 分支 data/
#   · 该项目仅收录 MaxMind 判定为中国大陆的 IPv4/IPv6 段，
#     所以「查不到记录」== 境外（或私有地址），无需再引入 GeoLite2-City。
#
# 用法：
#   bash tools/geocn/fetch-geocn.sh          # 拉取（覆盖已存在的同名文件）
#   bash tools/geocn/fetch-geocn.sh --check  # 只校验本地文件是否就绪，不联网
# ============================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="$REPO_ROOT/api/Resources/ipTo"
MMDB="$OUT_DIR/GeoCN.mmdb"
FULL="$OUT_DIR/full.txt"
SHORT="$OUT_DIR/short.txt"

MMDB_URL="https://github.com/ljxi/GeoCN/releases/latest/download/GeoCN.mmdb"
DIV_BASE="https://raw.githubusercontent.com/ljxi/GeoCN/main/data"

say() { printf '[geocn] %s\n' "$*"; }
die() { printf '[geocn] 错误：%s\n' "$*" >&2; exit 1; }

# 校验：mmdb 至少 1MB，且文件末尾含 MaxMind DB 的元数据标记。
check_mmdb() {
  local file="$1"
  [ -s "$file" ] || return 1
  local size
  size=$(wc -c < "$file")
  [ "$size" -gt 1048576 ] || return 1
  # 标记字节：ab cd ef "MaxMind.com"
  tail -c 512 "$file" | grep -qa 'MaxMind\.com' || return 1
  return 0
}

if [ "${1:-}" = "--check" ]; then
  ok=0
  if check_mmdb "$MMDB"; then
    say "GeoCN.mmdb OK（$(du -h "$MMDB" | cut -f1)）"
  else
    say "GeoCN.mmdb 缺失或损坏：$MMDB"; ok=1
  fi
  for f in "$FULL" "$SHORT"; do
    if [ -s "$f" ]; then say "$(basename "$f") OK（$(wc -l < "$f") 行）"; else say "$(basename "$f") 缺失"; ok=1; fi
  done
  exit $ok
fi

command -v curl >/dev/null 2>&1 || die "缺少 curl"

mkdir -p "$OUT_DIR"

# 下载到同目录临时文件，校验通过后再原子替换，避免半截文件被服务加载。
tmp="$OUT_DIR/.download.$$"
trap 'rm -f "$tmp"' EXIT

download() { # url dest
  local url="$1" dest="$2"
  say "下载 $url"
  curl -fL --retry 2 --connect-timeout 20 -o "$tmp" "$url" || die "下载失败：$url"
  mv -f "$tmp" "$dest"
}

download "$MMDB_URL" "$MMDB"
check_mmdb "$MMDB" || die "GeoCN.mmdb 校验失败（不是有效的 MMDB 文件）"

download "$DIV_BASE/full.txt" "$FULL"
download "$DIV_BASE/short.txt" "$SHORT"
[ -s "$FULL" ] && [ -s "$SHORT" ] || die "省市区映射表下载失败"

say "完成："
say "  mmdb   $(du -h "$MMDB" | cut -f1)  sha256=$(sha256sum "$MMDB" | cut -d' ' -f1)"
say "  full   $(wc -l < "$FULL") 行"
say "  short  $(wc -l < "$SHORT") 行"
say "重启后端后生效（Development：bash ~/notebook-devstack.sh restart dev）"
