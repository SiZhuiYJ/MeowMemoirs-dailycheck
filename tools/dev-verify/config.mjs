/**
 * 开发验证脚本的共享配置——唯一凭据来源。
 *
 * 设计原则：**脚本目录里不出现任何密钥**，凭据一律从
 * `api/appsettings.Development.json`（已被 .gitignore 忽略）读取，
 * 因此本目录可以安全地随仓库提交。
 *
 * 也可用环境变量覆盖（便于换端口/换环境）：
 *   DEV_VERIFY_API / DEV_VERIFY_JWT_KEY / DEV_VERIFY_REDIS_PASS / DEV_VERIFY_DB_USER / DEV_VERIFY_DB_PASS
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
/** 仓库根目录。 */
export const REPO_ROOT = resolve(HERE, "../..");

const SETTINGS_PATH = resolve(REPO_ROOT, "api/appsettings.Development.json");

function loadSettings() {
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
  } catch (error) {
    if (process.env.DEV_VERIFY_JWT_KEY && process.env.DEV_VERIFY_REDIS_PASS) return {};
    throw new Error(
      `无法读取 ${SETTINGS_PATH}：${error.message}\n` +
        "请确认已按 README 配置 api/appsettings.Development.json，或改用环境变量 DEV_VERIFY_JWT_KEY / DEV_VERIFY_REDIS_PASS / DEV_VERIFY_API。",
    );
  }
}

const settings = loadSettings();

const kestrelPort = /:(\d+)/.exec(settings?.Kestrel?.Endpoints?.Http?.Url ?? "")?.[1] ?? "5210";

export const API = process.env.DEV_VERIFY_API ?? `http://127.0.0.1:${kestrelPort}`;
export const JWT_KEY = process.env.DEV_VERIFY_JWT_KEY ?? settings?.Jwt?.Key ?? "";

const redisConfiguration = settings?.Redis?.Configuration ?? "";
export const REDIS_PASS =
  process.env.DEV_VERIFY_REDIS_PASS ?? /password=([^,]+)/.exec(redisConfiguration)?.[1] ?? "";

/** 前端依赖目录（SignalR 客户端从这里 require）。 */
export const WEB_PACKAGE_JSON = resolve(REPO_ROOT, "web/package.json");

/** 数据库密码：同样只从 appsettings.Development.json 的 ConnectionStrings:Default 解析。 */
const dbPassword =
  process.env.DEV_VERIFY_DB_PASS ??
  /(?:^|;)pwd=([^;]*)/.exec(settings?.ConnectionStrings?.Default ?? "")?.[1] ??
  "";

export const MYSQL = {
  user: process.env.DEV_VERIFY_DB_USER ?? "root",
  host: "127.0.0.1",
  database: "dailycheck",
  /** 空串表示数据库密码为空（此时 mariadb 客户端按无密码连接）。 */
  password: dbPassword,
};

/** 执行一条 SQL（-N -B：无表头、制表符分隔；NULL 输出为字面量 NULL）。 */
function runMariadb(sql) {
  try {
    return execFileSync(
      "mariadb",
      ["-u", MYSQL.user, "-h", MYSQL.host, MYSQL.database, "-N", "-B", "-e", sql],
      {
        // 密码走 MYSQL_PWD 环境变量，不放进 argv（避免被 ps / /proc 读到）
        env: { ...process.env, MYSQL_PWD: MYSQL.password },
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
      .toString()
      .trim();
  } catch (error) {
    const stderr = error.stderr?.toString().trim();
    throw new Error(`SQL 执行失败：${stderr || error.message}\nSQL：${String(sql).slice(0, 500)}`);
  }
}

/** 只读查询数据库（返回制表符分隔的单值/行）。 */
export function dbq(sql) {
  return runMariadb(sql);
}

/**
 * 写入型 SQL（INSERT/UPDATE/DELETE）。
 * 与 {@link dbq} 共用同一个执行器，单独导出是为了在调用处表达「会改数据」的语义。
 */
export function dbExec(sql) {
  return runMariadb(sql);
}

if (!JWT_KEY) throw new Error("缺少 Jwt:Key（配置或环境变量 DEV_VERIFY_JWT_KEY）");

/** redis-cli 封装。 */
export function rcli(...args) {
  return execFileSync(
    "redis-cli",
    ["-h", "127.0.0.1", "-a", REDIS_PASS, "--no-auth-warning", ...args],
    { stdio: ["ignore", "pipe", "ignore"] },
  )
    .toString()
    .trim();
}
