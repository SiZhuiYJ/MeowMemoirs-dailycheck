/**
 * 验证「登录设备列表 + 最后活跃时间 v3」。
 * 契约：/data/data/com.termux/files/home/tmp/device-activity-design.md 第 4 节。
 *
 * 覆盖：
 *   0. 预检：API / devices 表 / last_active_at 列（NOT NULL）/ device_id 列 / GET+POST active 鉴权
 *   1. 迁移只读校验：本地库 user 11 → 设备/记录数前后一致、legacy 设备 2 台、每台设备 last_active_at
 *      非空且 == 原 last_login_at（实际 user 11 数据在集成期有真实设备登录，设备数不再固定为 2/5）
 *   2. 临时测试用户（PBKDF2-SHA256 / 16B salt / 100000 轮 / 32B key，与 PasswordHasher.cs 同格式）
 *   3. 登录设备 A（X-Device-Id: verify-device-a，国内）+ 设备 B（verify-device-b，境外）→ devices 2 台
 *   4. GET /mm/LoginRecords：2 项、A isCurrent=true / B false、**无 status/logoutAt**、有 lastActiveAt、
 *      按 lastActiveAt 倒序；无 X-Device-Id 时用 token sid 兜底判定 isCurrent
 *   5. POST /mm/LoginRecords/active（token A + X-Device-Id A）→ 200、DB A.last_active_at 更新、B 不变
 *   6. token B 上报活跃后 GET → B isCurrent=true；POST /active 不写登录记录
 *   7. POST /active 带未登录过的 X-Device-Id: verify-device-c → 新建设备（last_login_record_id=NULL、
 *      无登录记录、loginAt 兜底为设备 last_login_at、location=NULL）；header 优先决定 isCurrent
 *   8. GET 契约回归：一台设备一行、计数为设备数、scope/非法 scope、分页夹取、401
 *   9. 迁移数据只读复核（user 11 前后快照一致）
 *
 * 运行（默认指向本机 dev 实例 5211；可用 DEV_VERIFY_API 覆盖）：
 *   node tools/dev-verify/verify-login-records.mjs
 *
 * 副作用（会清理干净）：
 *   · 临时创建 verify-login-records@example.test；结束时删除用户，devices/records 由 FK CASCADE 带走
 *     （清理后校验，残留则兜底删除并报失败）；
 *   · 清理该用户的 Redis 令牌 / 撤销标记；
 *   · 对 user 11 只做 SELECT（迁移数据只读校验），不写其数据。
 *
 * 凭据：只从 config.mjs（其内部读 api/appsettings.Development.json）取，不写死。
 */
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { API as CONFIG_API, dbq, dbExec, rcli } from "./config.mjs";

/**
 * 目标后端：
 *   · config.mjs 的 API 取自 api/appsettings.json 的 Kestrel 端口（= 5210，runit 生产实例），
 *     集成期间新代码只在 Lead 重启的 dev 实例（5211）上；
 *   · 本套件默认 5211，可用 DEV_VERIFY_API 覆盖。
 */
const API = process.env.DEV_VERIFY_API ?? "http://127.0.0.1:5211";

const EMAIL = "verify-login-records@example.test";
const USER_ACCOUNT = "verify_login_records";
const PASSWORD = "Verify-Login-Records-2026!";

// 客户端持久化设备 ID（X-Device-Id，清洗后 8..64 字符）
const DEVICE_A = "verify-device-a";
const DEVICE_B = "verify-device-b";
const DEVICE_C = "verify-device-c";

// 国内：222.137.1.1 = 河南郑州联通（GeoCN 命中）
const CN_XFF = "222.137.1.1";
const CN_PROVINCE = "河南";
const CN_CITY = "郑州";
const CN_LOCATION = "河南 · 郑州";
// 境外：Google DNS，GeoCN 不命中
const OVERSEAS_XFF = "8.8.8.8";

const UA_WEIXIN_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) " +
  "Mobile/15E148 MicroMessenger/8.0.49(0x18003128) NetType/WIFI Language/zh_CN";
const UA_CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0.0.0 Mobile Safari/537.36";
const UA_CHROME_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0.0.0 Safari/537.36";

// 迁移数据：本地库既有真实数据（只读校验，不改）
const MIGRATION_USER_ID = 11;

// ---------------------------------------------------------------------------
// 断言框架（PASS/FAIL 汇总 + 失败可复现命令 + 非 0 退出码）
// ---------------------------------------------------------------------------
let passCount = 0;
const failures = [];
let uid = null; // 临时测试用户 id
const sids = []; // 本次登录产生过的 sid（清理 revoked_sid:*）
let canUseRecords = false;
let hasDevicesTable = false;
let hasDeviceIdColumn = false;
let hasLastActiveColumn = false;

function section(title) {
  console.log(`\n=== ${title} ===`);
}
function info(message) {
  console.log(`  INFO  ${message}`);
}
function fmt(value) {
  if (value === undefined) return "";
  try {
    const text = JSON.stringify(value);
    return text.length > 340 ? `${text.slice(0, 340)}…` : text;
  } catch {
    return String(value);
  }
}
function check(label, ok, detail, repro) {
  if (ok) {
    passCount += 1;
    console.log(`  PASS  ${label}${detail !== undefined ? ` -> ${fmt(detail)}` : ""}`);
    return true;
  }
  failures.push({ label, repro });
  console.log(`  FAIL  ${label}${detail !== undefined ? ` -> ${fmt(detail)}` : ""}`);
  if (repro) console.log(`        复现: ${repro}`);
  return false;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// HTTP / JWT
// ---------------------------------------------------------------------------
async function http(method, path, { token, headers = {}, body } = {}) {
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    return { status: 0, body: null, text: "", error: String(error) };
  }
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: response.status, body: parsed, text };
}

/** 失败用例的可复现 curl（$TOKEN 用登录响应里的 token 替换）。 */
function apiRepro(method, path, { token, headers, body } = {}) {
  const parts = ["curl -s", `-X ${method}`, `"${API}${path}"`];
  if (token) parts.push('-H "Authorization: Bearer $TOKEN"');
  for (const [key, value] of Object.entries(headers ?? {})) parts.push(`-H ${JSON.stringify(`${key}: ${value}`)}`);
  if (body !== undefined) parts.push('-H "Content-Type: application/json"', `-d ${JSON.stringify(JSON.stringify(body))}`);
  return parts.join(" ");
}

function decodeJwt(token) {
  const payload = String(token ?? "").split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// DB 小工具（mariadb -N -B；NULL 输出为字面量 NULL）
// ---------------------------------------------------------------------------
const sqlStr = (value) => `'${String(value).replace(/'/g, "''")}'`;
const sqlNull = (value) => (value === "NULL" ? null : value);

/** 可复现的 SQL 命令（密码仍从 appsettings.Development.json 解析，不写死）。 */
function dbCmd(sql) {
  const readPassword =
    `python3 -c "import json;print(json.load(open('api/appsettings.Development.json'))` +
    `['ConnectionStrings']['Default'].split('pwd=')[1].split(';')[0])"`;
  return `MYSQL_PWD=$(${readPassword}) mariadb -u root -h 127.0.0.1 dailycheck -e ${JSON.stringify(sql)}`;
}

function dbRows(sql) {
  const out = dbq(sql);
  if (out === "") return [];
  return out.split("\n").map((line) => line.split("\t").map(sqlNull));
}
function dbScalar(sql) {
  const rows = dbRows(sql);
  return rows.length ? rows[0][0] : null;
}
function tableExists(name) {
  try {
    return (
      dbq(
        `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ${sqlStr(name)}`,
      ) === "1"
    );
  } catch {
    return false;
  }
}
function columnExists(table, column) {
  try {
    return (
      dbq(
        `SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ${sqlStr(table)} AND column_name = ${sqlStr(column)}`,
      ) === "1"
    );
  } catch {
    return false;
  }
}
function columnNullable(table, column) {
  try {
    return dbq(
      `SELECT is_nullable FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ${sqlStr(table)} AND column_name = ${sqlStr(column)} LIMIT 1`,
    );
  } catch {
    return null;
  }
}
function findUserIdByEmail() {
  const value = dbq(`SELECT id FROM users WHERE email = ${sqlStr(EMAIL)} LIMIT 1`);
  return value === "" ? null : Number(value);
}

// —— user_login_devices（v3：含 last_active_at） ——
const DEVICE_COLUMNS = [
  "id",
  "user_id",
  "device_key",
  "device",
  "platform",
  "DATE_FORMAT(first_login_at, '%Y-%m-%d %H:%i:%s')",
  "DATE_FORMAT(last_login_at, '%Y-%m-%d %H:%i:%s')",
  "DATE_FORMAT(last_active_at, '%Y-%m-%d %H:%i:%s')",
  "last_login_record_id",
].join(", ");

function mapDevice(row) {
  return {
    id: Number(row[0]),
    userId: Number(row[1]),
    deviceKey: row[2],
    device: row[3],
    platform: row[4],
    firstLoginAt: row[5],
    lastLoginAt: row[6],
    lastActiveAt: row[7],
    lastLoginRecordId: row[8] === null ? null : Number(row[8]),
  };
}

/** 当前测试用户的设备（按 id 升序）；表/列不存在或查询失败返回 null。 */
function devices() {
  if (!hasDevicesTable || !hasLastActiveColumn || uid === null) return null;
  try {
    return dbRows(`SELECT ${DEVICE_COLUMNS} FROM user_login_devices WHERE user_id = ${uid} ORDER BY id ASC`).map(mapDevice);
  } catch {
    return null;
  }
}
function deviceCount() {
  if (!hasDevicesTable || uid === null) return null;
  try {
    return Number(dbScalar(`SELECT COUNT(*) FROM user_login_devices WHERE user_id = ${uid}`) ?? "0");
  } catch {
    return null;
  }
}

// —— user_login_records（v2 起含 device_id） ——
function recordColumns() {
  const deviceIdExpression = hasDeviceIdColumn ? "device_id" : "NULL";
  return [
    "id",
    "user_id",
    deviceIdExpression,
    "session_id",
    "login_type",
    "platform",
    "device",
    "user_agent",
    "ip",
    "location",
    "province",
    "city",
    "district",
    "isp",
    "is_domestic",
    "DATE_FORMAT(login_at, '%Y-%m-%d %H:%i:%s')",
    "DATE_FORMAT(logout_at, '%Y-%m-%d %H:%i:%s')",
  ].join(", ");
}

function mapRecord(row) {
  return {
    id: Number(row[0]),
    userId: Number(row[1]),
    deviceId: row[2] === null ? null : Number(row[2]),
    sessionId: row[3],
    loginType: row[4],
    platform: row[5],
    device: row[6],
    userAgent: row[7],
    ip: row[8],
    location: row[9],
    province: row[10],
    city: row[11],
    district: row[12],
    isp: row[13],
    isDomestic: row[14],
    loginAt: row[15],
    logoutAt: row[16],
  };
}

/** 当前测试用户的登录记录（按 id 升序）；表不存在/查询失败返回 null。 */
function records(where = `user_id = ${uid}`) {
  if (!canUseRecords || uid === null) return null;
  try {
    return dbRows(`SELECT ${recordColumns()} FROM user_login_records WHERE ${where} ORDER BY id ASC`).map(mapRecord);
  } catch {
    return null;
  }
}
function recordCount() {
  if (!canUseRecords || uid === null) return null;
  try {
    return Number(dbScalar(`SELECT COUNT(*) FROM user_login_records WHERE user_id = ${uid}`) ?? "0");
  } catch {
    return null;
  }
}
function recordById(id) {
  if (!Number.isFinite(Number(id))) return null;
  const rows = records(`user_id = ${uid} AND id = ${Number(id)}`);
  return rows && rows.length ? rows[0] : null;
}

/** 表/列不可用时的说明，用于失败详情。 */
function schemaDetail(extra = "") {
  const parts = [];
  if (!hasDevicesTable) parts.push("缺少 user_login_devices 表");
  if (hasDevicesTable && !hasLastActiveColumn) parts.push("缺少 devices.last_active_at 列（v3 迁移未执行）");
  if (!hasDeviceIdColumn) parts.push("缺少 records.device_id 列（v2 迁移未执行）");
  if (parts.length) return parts.join("；");
  return extra;
}

// 时间（DB 里是 UTC 无时区串；API 契约示例带 Z，缺时区也按 UTC 解析）
function parseDbUtc(value) {
  return value ? Date.parse(`${String(value).replace(" ", "T")}Z`) : Number.NaN;
}
function parseApiUtc(value) {
  if (typeof value !== "string" || !value) return Number.NaN;
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`);
}
const withinMinutes = (timestamp, minutes = 5) =>
  Number.isFinite(timestamp) && Math.abs(Date.now() - timestamp) <= minutes * 60_000;
const tsEqual = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1000;
const findItem = (items, deviceId) =>
  Array.isArray(items) ? items.find((item) => Number(item?.deviceId) === Number(deviceId)) : undefined;
const itemById = findItem;
const hasOwn = (object, key) => object != null && Object.prototype.hasOwnProperty.call(object, key);

// ---------------------------------------------------------------------------
// 测试用户准备 / 清理
// ---------------------------------------------------------------------------
/** 与 api/Infrastructure/PasswordHasher.cs 完全一致的哈希格式：base64(16B salt):base64(32B key)。 */
function hashPassword(password) {
  const salt = randomBytes(16);
  const key = pbkdf2Sync(password, salt, 100_000, 32, "sha256");
  return `${salt.toString("base64")}:${key.toString("base64")}`;
}

function redisKeysFor(targetUid) {
  return [
    `access_token:${targetUid}`,
    `refresh_token:${targetUid}`,
    `auth_revoked_before:${targetUid}`,
    ...sids.map((sid) => `revoked_sid:${sid}`),
  ];
}

/**
 * 删除测试用户：优先只删 users 行，依赖 FK CASCADE 带走 devices/records；
 * 若仍有残留（级联失效），兜底按「records → devices → users」顺序清理并报告。
 */
function deleteTestUserRows(targetUid, problems) {
  try {
    dbExec(`DELETE FROM users WHERE id = ${targetUid}`);
  } catch (error) {
    problems.push(`删除测试用户失败：${error.message.split("\n")[0]}`);
  }

  let remainRecords = 0;
  let remainDevices = 0;
  try {
    remainRecords = canUseRecords
      ? Number(dbScalar(`SELECT COUNT(*) FROM user_login_records WHERE user_id = ${targetUid}`) ?? "0")
      : 0;
    remainDevices = hasDevicesTable
      ? Number(dbScalar(`SELECT COUNT(*) FROM user_login_devices WHERE user_id = ${targetUid}`) ?? "0")
      : 0;
  } catch (error) {
    problems.push(`清理残留校验失败：${error.message.split("\n")[0]}`);
  }

  if (remainDevices > 0 || remainRecords > 0) {
    problems.push(`FK CASCADE 未生效：删用户后仍残留 devices=${remainDevices} / records=${remainRecords}（已兜底删除）`);
    try {
      if (canUseRecords) dbExec(`DELETE FROM user_login_records WHERE user_id = ${targetUid}`);
      if (hasDevicesTable) dbExec(`DELETE FROM user_login_devices WHERE user_id = ${targetUid}`);
      dbExec(`DELETE FROM users WHERE id = ${targetUid}`);
    } catch (error) {
      problems.push(`兜底删除残留数据失败：${error.message.split("\n")[0]}`);
    }
  }
}

function resetStaleTestData() {
  try {
    const staleUid = findUserIdByEmail();
    if (staleUid === null) return;
    try {
      rcli("del", ...redisKeysFor(staleUid));
    } catch {
      /* Redis 不可用也继续，删库才是关键 */
    }
    const problems = [];
    deleteTestUserRows(staleUid, problems);
    console.log(`  INFO  已清理上次残留的测试用户 id=${staleUid}${problems.length ? `（${problems.join("；")}）` : ""}`);
  } catch (error) {
    console.log(`  INFO  清理上次残留失败（继续）：${error.message.split("\n")[0]}`);
  }
}

function cleanupTestData() {
  const problems = [];
  let targetUid = uid;
  if (targetUid === null) {
    try {
      targetUid = findUserIdByEmail();
    } catch (error) {
      problems.push(`查询残留测试用户失败：${error.message.split("\n")[0]}`);
    }
  }

  if (targetUid !== null) {
    try {
      const keys = redisKeysFor(targetUid);
      rcli("del", ...keys);
      const remainKeys = rcli("exists", ...keys);
      if (remainKeys !== "0") problems.push(`Redis 清理后仍存在 ${remainKeys} 个键`);
    } catch (error) {
      problems.push(`Redis 清理失败：${error.message.split("\n")[0]}`);
    }
    deleteTestUserRows(targetUid, problems);
  }

  // 兜底：按邮箱再删一次（覆盖 uid 未知/插入半途失败）
  try {
    dbExec(`DELETE FROM users WHERE email = ${sqlStr(EMAIL)}`);
  } catch (error) {
    problems.push(`兜底删除测试用户失败：${error.message.split("\n")[0]}`);
  }

  // 清理结果校验
  try {
    const remainUsers = Number(dbScalar(`SELECT COUNT(*) FROM users WHERE email = ${sqlStr(EMAIL)}`) ?? "0");
    if (remainUsers !== 0) problems.push(`清理后仍残留 ${remainUsers} 个测试用户`);
    if (targetUid !== null) {
      if (canUseRecords) {
        const remainRecords = Number(
          dbScalar(`SELECT COUNT(*) FROM user_login_records WHERE user_id = ${targetUid}`) ?? "0",
        );
        if (remainRecords !== 0) problems.push(`清理后仍残留 ${remainRecords} 条登录记录`);
      }
      if (hasDevicesTable) {
        const remainDevices = Number(
          dbScalar(`SELECT COUNT(*) FROM user_login_devices WHERE user_id = ${targetUid}`) ?? "0",
        );
        if (remainDevices !== 0) problems.push(`清理后仍残留 ${remainDevices} 台登录设备`);
      }
    }
  } catch (error) {
    problems.push(`清理校验失败：${error.message.split("\n")[0]}`);
  }

  return problems;
}

// ---------------------------------------------------------------------------
// 迁移数据只读快照（user 11）
// ---------------------------------------------------------------------------
function migrationSnapshot() {
  if (!hasDevicesTable || !hasDeviceIdColumn || !hasLastActiveColumn) return null;
  try {
    const perDevice = dbRows(
      `SELECT id, device_key, device, ` +
        `DATE_FORMAT(last_login_at, '%Y-%m-%d %H:%i:%s'), ` +
        `DATE_FORMAT(last_active_at, '%Y-%m-%d %H:%i:%s'), ` +
        `DATE_FORMAT(first_login_at, '%Y-%m-%d %H:%i:%s'), last_login_record_id ` +
        `FROM user_login_devices WHERE user_id = ${MIGRATION_USER_ID} ORDER BY id`,
    ).map((row) => ({
      id: Number(row[0]),
      deviceKey: row[1],
      device: row[2],
      lastLoginAt: row[3],
      lastActiveAt: row[4],
      firstLoginAt: row[5],
      lastLoginRecordId: row[6] === null ? null : Number(row[6]),
    }));
    return {
      deviceCount: Number(dbScalar(`SELECT COUNT(*) FROM user_login_devices WHERE user_id = ${MIGRATION_USER_ID}`) ?? "0"),
      recordCount: Number(dbScalar(`SELECT COUNT(*) FROM user_login_records WHERE user_id = ${MIGRATION_USER_ID}`) ?? "0"),
      nullLastActiveCount: Number(
        dbScalar(`SELECT COUNT(*) FROM user_login_devices WHERE user_id = ${MIGRATION_USER_ID} AND last_active_at IS NULL`) ??
          "0",
      ),
      perDevice,
      legacyDeviceCount: perDevice.filter((row) => /^legacy:/i.test(row.deviceKey ?? "")).length,
      nullRecordDeviceCount: Number(
        dbScalar(`SELECT COUNT(*) FROM user_login_records WHERE user_id = ${MIGRATION_USER_ID} AND device_id IS NULL`) ??
          "0",
      ),
      recordIds: sqlNull(
        dbq(`SELECT GROUP_CONCAT(id ORDER BY id) FROM user_login_records WHERE user_id = ${MIGRATION_USER_ID}`),
      ),
      deviceIds: sqlNull(
        dbq(`SELECT GROUP_CONCAT(id ORDER BY id) FROM user_login_devices WHERE user_id = ${MIGRATION_USER_ID}`),
      ),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 登录 / 活跃上报辅助
// ---------------------------------------------------------------------------
async function loginWith(label, { xff, deviceId, platform, device, userAgent } = {}) {
  const headers = {};
  if (xff) headers["X-Forwarded-For"] = xff;
  if (deviceId) headers["X-Device-Id"] = deviceId;
  if (platform) headers["X-Client-Platform"] = platform;
  if (device) headers["X-Client-Device"] = device;
  if (userAgent) headers["User-Agent"] = userAgent;
  const res = await http("POST", "/mm/Auth/login", { headers, body: { email: EMAIL, password: PASSWORD } });
  const payload = decodeJwt(res.body?.token);
  if (payload?.sid) sids.push(payload.sid);
  info(`登录「${label}」status=${res.status}${payload?.sid ? ` sid=${payload.sid}` : ""}`);
  return { res, payload, token: res.body?.token, refreshToken: res.body?.refreshToken, sid: payload?.sid, headers };
}

function loginRepro(headers) {
  return apiRepro("POST", "/mm/Auth/login", {
    headers: { ...headers, "Content-Type": "application/json" },
    body: { email: EMAIL, password: "<测试密码>" },
  });
}

/** POST /mm/LoginRecords/active（上报设备活跃）。 */
async function touchActive(label, { token, deviceId, platform, device, userAgent } = {}) {
  const headers = {};
  if (deviceId) headers["X-Device-Id"] = deviceId;
  if (platform) headers["X-Client-Platform"] = platform;
  if (device) headers["X-Client-Device"] = device;
  if (userAgent) headers["User-Agent"] = userAgent;
  const res = await http("POST", "/mm/LoginRecords/active", { token, headers });
  info(`活跃上报「${label}」status=${res.status}${res.body?.lastActiveAt ? ` lastActiveAt=${res.body.lastActiveAt}` : ""}`);
  return { res, headers };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
console.log(`\n目标后端: ${API}${process.env.DEV_VERIFY_API ? "" : "（默认：本机 dev 实例）"}`);
if (CONFIG_API !== API) {
  console.log(
    `说明: config.mjs 的 API=${CONFIG_API} 来自 appsettings.json 的 Kestrel（runit 生产实例）；` +
      "本套件默认 5211，可用 DEV_VERIFY_API 覆盖。",
  );
}
console.log(`临时测试用户: ${EMAIL}（脚本结束会删除）`);
console.log(`迁移只读校验用户: user ${MIGRATION_USER_ID}（只 SELECT，不写）`);

try {
  // =========================================================================
  section("0. 预检（API / devices 表 / last_active_at 列 / 鉴权）");
  const ping = await http("GET", "/mm/Auth/me");
  check("API 可达（GET /mm/Auth/me 无 token → 401）", ping.status === 401, {
    status: ping.status,
    error: ping.error,
  });
  if (ping.status === 0) throw new Error(`API 不可达：${API}（${ping.error}）`);

  canUseRecords = tableExists("user_login_records");
  check(
    "user_login_records 表存在",
    canUseRecords,
    canUseRecords ? "存在" : "缺表",
    dbCmd("SHOW TABLES LIKE 'user_login_records';"),
  );
  hasDevicesTable = tableExists("user_login_devices");
  check(
    "user_login_devices 表存在",
    hasDevicesTable,
    hasDevicesTable ? "存在" : "缺表（v2 迁移未执行）",
    dbCmd("SHOW TABLES LIKE 'user_login_devices';"),
  );
  hasDeviceIdColumn = canUseRecords && columnExists("user_login_records", "device_id");
  check(
    "user_login_records.device_id 列已添加（v2 迁移）",
    hasDeviceIdColumn,
    hasDeviceIdColumn ? "存在" : "缺列（v2 迁移未执行）",
    dbCmd("SHOW COLUMNS FROM user_login_records LIKE 'device_id';"),
  );
  hasLastActiveColumn = hasDevicesTable && columnExists("user_login_devices", "last_active_at");
  check(
    "user_login_devices.last_active_at 列已添加（v3 迁移）",
    hasLastActiveColumn,
    hasLastActiveColumn ? "存在" : "缺列：先执行 sql/2026-11-19_user_login_devices_activity.sql",
    dbCmd("SHOW COLUMNS FROM user_login_devices LIKE 'last_active_at';"),
  );
  const lastActiveNullable = hasLastActiveColumn ? columnNullable("user_login_devices", "last_active_at") : null;
  check(
    "user_login_devices.last_active_at 已改 NOT NULL（回填完成）",
    lastActiveNullable === "NO",
    lastActiveNullable ?? "列不存在",
    dbCmd("SHOW COLUMNS FROM user_login_devices LIKE 'last_active_at';"),
  );

  const noTokenGet = await http("GET", "/mm/LoginRecords");
  check(
    "GET /mm/LoginRecords 未带 token → 401",
    noTokenGet.status === 401,
    { status: noTokenGet.status, body: noTokenGet.status === 200 ? noTokenGet.body : undefined },
    apiRepro("GET", "/mm/LoginRecords"),
  );
  const noTokenActive = await http("POST", "/mm/LoginRecords/active");
  check(
    "POST /mm/LoginRecords/active 未带 token → 401",
    noTokenActive.status === 401,
    { status: noTokenActive.status, body: noTokenActive.status === 200 ? noTokenActive.body : undefined },
    apiRepro("POST", "/mm/LoginRecords/active"),
  );

  // =========================================================================
  section("1. 迁移只读校验（本地库 user 11：设备/记录保留、legacy 2 台、last_active_at ≥ last_login_at）");
  const migrationBefore = migrationSnapshot();
  check(
    "迁移数据可校验（user_login_devices + last_active_at 已就绪）",
    migrationBefore !== null,
    schemaDetail(),
    dbCmd(`SELECT * FROM user_login_devices WHERE user_id = ${MIGRATION_USER_ID};`),
  );
  if (migrationBefore) {
    // 注意：契约正文写的「user 11 → 2 台设备 / 5 条记录」是 v2 迁移时的基线；
    // 集成期有真实设备（小程序 / web）登录过 user 11，设备/记录数已增长（见 INFO）。
    // 因此这里不硬编码总数，改成校验「原有数据不丢 + 迁移回填正确 + 全程只读不变」。
    check(
      `用户 ${MIGRATION_USER_ID} 迁移后设备数 ≥ 2（原有设备保留）`,
      migrationBefore.deviceCount >= 2,
      { devices: migrationBefore.deviceCount, records: migrationBefore.recordCount },
      dbCmd(`SELECT COUNT(*) FROM user_login_devices WHERE user_id = ${MIGRATION_USER_ID};`),
    );
    check(
      `用户 ${MIGRATION_USER_ID} 迁移生成的 legacy 设备 = 2 台（旧记录按 user_id+platform+device 归并）`,
      migrationBefore.legacyDeviceCount === 2,
      migrationBefore.perDevice.filter((row) => /^legacy:/i.test(row.deviceKey ?? "")),
      dbCmd(`SELECT id, device_key FROM user_login_devices WHERE user_id = ${MIGRATION_USER_ID} AND device_key LIKE 'legacy:%';`),
    );
    check(
      `用户 ${MIGRATION_USER_ID} 设备 last_active_at 全部非空`,
      migrationBefore.nullLastActiveCount === 0,
      migrationBefore.nullLastActiveCount,
      dbCmd(`SELECT COUNT(*) FROM user_login_devices WHERE user_id = ${MIGRATION_USER_ID} AND last_active_at IS NULL;`),
    );
    // 迁移回填保证 last_active_at == last_login_at；但集成期这台设备可能被真实打开过
    // （登录记录页 / App 启动会上报活跃），last_active_at 只会更大，所以校验 ≥ 而不是 ==。
    check(
      `用户 ${MIGRATION_USER_ID} 每台设备 last_active_at ≥ 原 last_login_at（回填未回退）`,
      migrationBefore.perDevice.length >= 2 &&
        migrationBefore.perDevice.every(
          (row) =>
            row.lastActiveAt !== null &&
            row.lastLoginAt !== null &&
            row.lastActiveAt >= row.lastLoginAt,
        ),
      migrationBefore.perDevice.map((row) => ({ id: row.id, login: row.lastLoginAt, active: row.lastActiveAt })),
      dbCmd(
        `SELECT id, last_login_at, last_active_at FROM user_login_devices WHERE user_id = ${MIGRATION_USER_ID};`,
      ),
    );
    check(
      `用户 ${MIGRATION_USER_ID} 记录 device_id 全部非空（v2 回填未回退）`,
      migrationBefore.nullRecordDeviceCount === 0,
      migrationBefore.nullRecordDeviceCount,
      dbCmd(`SELECT COUNT(*) FROM user_login_records WHERE user_id = ${MIGRATION_USER_ID} AND device_id IS NULL;`),
    );
    info(`迁移快照: ${JSON.stringify(migrationBefore)}`);
    info(
      `注：契约正文的「user 11 = 2 台设备 / 5 条记录」是 v2 基线；当前实际 ${migrationBefore.deviceCount} 台设备 / ${migrationBefore.recordCount} 条记录（集成期真实设备登录过），以上断言按实际数据校验。`,
    );
  } else {
    console.log(
      "  NOTE  devices 表/last_active_at 列缺失（v2/v3 迁移未执行），迁移相关断言按预期失败；dry-run 继续验证脚本自身逻辑。",
    );
  }

  // =========================================================================
  section("2. 临时测试用户（PBKDF2 哈希与 PasswordHasher.cs 同格式）");
  resetStaleTestData();
  const passwordHash = hashPassword(PASSWORD);
  check(
    "PBKDF2 哈希格式 base64(16B salt):base64(32B key)",
    /^[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]{43}=$/.test(passwordHash),
    "salt 16B / key 32B / SHA256 / 100000 轮",
  );
  dbExec(
    `INSERT INTO users (email, password_hash, nick_name, user_account, status, role) VALUES (` +
      `${sqlStr(EMAIL)}, ${sqlStr(passwordHash)}, '验证-设备活跃v3', ${sqlStr(USER_ACCOUNT)}, 1, 'user')`,
  );
  uid = findUserIdByEmail();
  check("测试用户已写入 users", Number.isInteger(uid) && uid > 0, { uid });
  if (uid === null) throw new Error("测试用户插入失败，无法继续");

  // =========================================================================
  section("3. 登录设备 A（国内）+ 设备 B（境外）→ 2 台设备 / 2 条记录");
  const dA = await loginWith("设备 A 登录（国内）", {
    xff: CN_XFF,
    deviceId: DEVICE_A,
    platform: "mp-weixin",
    device: "iPhone 13",
    userAgent: UA_WEIXIN_IPHONE,
  });
  check("设备 A 登录 200 且返回 access token", dA.res.status === 200 && Boolean(dA.token), {
    status: dA.res.status,
    body: dA.res.status === 200 ? undefined : dA.res.body,
  }, loginRepro(dA.headers));
  if (dA.res.status !== 200) throw new Error(`测试用户登录失败（${dA.res.status}）：哈希格式或账号状态异常`);
  check("A token 带 sid", typeof dA.sid === "string" && dA.sid.length > 0, { sid: dA.sid });

  await sleep(1200); // 秒级 datetime：拉开两台设备的时间，便于验证排序/活跃更新
  const dB = await loginWith("设备 B 登录（境外）", {
    xff: OVERSEAS_XFF,
    deviceId: DEVICE_B,
    platform: "h5",
    device: "Pixel 8",
    userAgent: UA_CHROME_ANDROID,
  });
  check("设备 B 登录 200 且返回 access token", dB.res.status === 200 && Boolean(dB.token), { status: dB.res.status });
  check("B token 带 sid", typeof dB.sid === "string" && dB.sid.length > 0, { sid: dB.sid });

  const devs3 = devices();
  check(
    "DB: 登录后 devices = 2 台",
    Array.isArray(devs3) && devs3.length === 2,
    devs3?.length ?? schemaDetail(),
    dbCmd(`SELECT ${DEVICE_COLUMNS} FROM user_login_devices WHERE user_id = ${uid};`),
  );
  const devA = devs3?.find((row) => row.deviceKey === DEVICE_A);
  const devB = devs3?.find((row) => row.deviceKey === DEVICE_B);
  if (devA) {
    check("DB: 设备 A device = 'iPhone 13 · 微信' / platform = mp-weixin", devA.device === "iPhone 13 · 微信" && devA.platform === "mp-weixin", { device: devA.device, platform: devA.platform });
    check("DB: 设备 A last_active_at 非空且近 5 分钟 UTC", withinMinutes(parseDbUtc(devA.lastActiveAt)), devA.lastActiveAt);
    check("DB: 设备 A 登录同时更新 last_active_at == last_login_at", Boolean(devA.lastActiveAt && devA.lastLoginAt) && tsEqual(parseDbUtc(devA.lastActiveAt), parseDbUtc(devA.lastLoginAt)), { active: devA.lastActiveAt, login: devA.lastLoginAt });
  }
  if (devB) {
    check("DB: 设备 B device = 'Pixel 8' / platform = h5", devB.device === "Pixel 8" && devB.platform === "h5", { device: devB.device, platform: devB.platform });
    check("DB: 设备 B last_active_at 非空且近 5 分钟 UTC", withinMinutes(parseDbUtc(devB.lastActiveAt)), devB.lastActiveAt);
  }

  const recs3 = records();
  check("DB: 登录后 records = 2 条", Array.isArray(recs3) && recs3.length === 2, recs3?.length ?? schemaDetail());
  const rA = recs3?.find((row) => row.deviceId === devA?.id);
  const rB = recs3?.find((row) => row.deviceId === devB?.id);
  check("DB: 两个设备各有 1 条登录记录（device_id 指向正确）", Boolean(rA && rB), { rA: rA?.deviceId, rB: rB?.deviceId, devA: devA?.id, devB: devB?.id });
  if (rA) {
    check("DB: A 记录 ip/location = 222.137.1.1 / '河南 · 郑州'", rA.ip === CN_XFF && rA.location === CN_LOCATION, { ip: rA.ip, location: rA.location });
    check("DB: A 记录 session_id == token A sid", rA.sessionId === dA.sid, { db: rA.sessionId, token: dA.sid });
  }
  if (rB) {
    check("DB: B 记录 is_domestic=0 / location='境外'", rB.isDomestic === "0" && rB.location === "境外", { isDomestic: rB.isDomestic, location: rB.location });
  }
  check("DB: 设备 last_login_record_id 指向各自最新记录", Number.isFinite(devA?.lastLoginRecordId) && devA.lastLoginRecordId === rA?.id && Number.isFinite(devB?.lastLoginRecordId) && devB.lastLoginRecordId === rB?.id, { a: devA?.lastLoginRecordId, ra: rA?.id, b: devB?.lastLoginRecordId, rb: rB?.id });

  // =========================================================================
  section("4. GET /mm/LoginRecords（v3）：无 status/logoutAt、有 lastActiveAt/isCurrent、按活跃时间倒序");
  const get4 = await http("GET", "/mm/LoginRecords?scope=all", { token: dA.token, headers: { "X-Device-Id": DEVICE_A } });
  check(
    "GET scope=all（token A + header A）200",
    get4.status === 200,
    { status: get4.status, body: get4.status === 200 ? undefined : get4.body },
    apiRepro("GET", "/mm/LoginRecords?scope=all", { token: true, headers: { "X-Device-Id": DEVICE_A } }),
  );
  const items4 = get4.body?.items ?? [];
  check("GET: 2 项（一台设备一行）", items4.length === 2, items4.map((item) => item.deviceId));
  check(
    "GET: 按 lastActiveAt DESC（B 登录更晚，B 在前）",
    Number(items4[0]?.deviceId) === devB?.id && Number(items4[1]?.deviceId) === devA?.id,
    { got: items4.map((item) => item.deviceId), expect: [devB?.id, devA?.id] },
  );
  const itemA4 = itemById(items4, devA?.id);
  const itemB4 = itemById(items4, devB?.id);
  check("GET: A isCurrent=true（X-Device-Id 匹配）/ B isCurrent=false", itemA4?.isCurrent === true && itemB4?.isCurrent === false, { a: itemA4?.isCurrent, b: itemB4?.isCurrent });
  check(
    "GET: items 不含旧字段 status / logoutAt",
    items4.length > 0 && items4.every((item) => !hasOwn(item, "status") && !hasOwn(item, "logoutAt")),
    items4.map((item) => ({ deviceId: item.deviceId, keys: Object.keys(item) })),
  );
  check(
    "GET: items 不含旧字段 id（deviceId 替代）",
    items4.length === 2 && items4.every((item) => !hasOwn(item, "id") && typeof Number(item.deviceId) === "number"),
    items4.map((item) => ({ deviceId: item.deviceId, id: item.id })),
  );
  check(
    "GET: 每项都有 lastActiveAt（UTC 时间）且非空",
    items4.length === 2 && items4.every((item) => withinMinutes(parseApiUtc(item.lastActiveAt))),
    items4.map((item) => item.lastActiveAt),
  );
  if (itemA4) {
    check("GET: A 项 lastActiveAt 与 DB 设备 A 一致", tsEqual(parseApiUtc(itemA4.lastActiveAt), parseDbUtc(devA?.lastActiveAt)), { api: itemA4.lastActiveAt, db: devA?.lastActiveAt });
    check("GET: A 项 loginAt = A 最后一条登录记录时间", tsEqual(parseApiUtc(itemA4.loginAt), parseDbUtc(rA?.loginAt)), { api: itemA4.loginAt, db: rA?.loginAt });
    check("GET: A 项 location='河南 · 郑州' / ipMasked='222.137.*.*' / isDomestic=true", itemA4.location === CN_LOCATION && itemA4.ipMasked === "222.137.*.*" && itemA4.isDomestic === true, { location: itemA4.location, ipMasked: itemA4.ipMasked, isDomestic: itemA4.isDomestic });
    check("GET: A 项 loginType=password / device='iPhone 13 · 微信' / platform=mp-weixin", itemA4.loginType === "password" && itemA4.device === "iPhone 13 · 微信" && itemA4.platform === "mp-weixin", { loginType: itemA4.loginType, device: itemA4.device, platform: itemA4.platform });
    check("GET: A 项 province=河南 / city=郑州", itemA4.province === CN_PROVINCE && itemA4.city === CN_CITY, { province: itemA4.province, city: itemA4.city });
  }
  if (itemB4) {
    check("GET: B 项 location='境外' / isDomestic=false / ipMasked='8.8.*.*'", itemB4.location === "境外" && itemB4.isDomestic === false && itemB4.ipMasked === "8.8.*.*", { location: itemB4.location, isDomestic: itemB4.isDomestic, ipMasked: itemB4.ipMasked });
    check("GET: B 项 lastActiveAt 与 DB 设备 B 一致", tsEqual(parseApiUtc(itemB4.lastActiveAt), parseDbUtc(devB?.lastActiveAt)), { api: itemB4.lastActiveAt, db: devB?.lastActiveAt });
  }
  check(
    "GET: total=2 / domesticTotal=1 / allTotal=2（设备数）",
    get4.body?.total === 2 && get4.body?.domesticTotal === 1 && get4.body?.allTotal === 2,
    { total: get4.body?.total, domestic: get4.body?.domesticTotal, all: get4.body?.allTotal },
  );

  const get4dom = await http("GET", "/mm/LoginRecords?scope=domestic", { token: dA.token, headers: { "X-Device-Id": DEVICE_A } });
  const items4dom = get4dom.body?.items ?? [];
  check("GET domestic: 只有 A 1 项（B 为境外）", items4dom.length === 1 && Number(items4dom[0]?.deviceId) === devA?.id, items4dom.map((item) => item.deviceId));
  check("GET domestic: total=1 / domesticTotal=1 / allTotal=2", get4dom.body?.total === 1 && get4dom.body?.domesticTotal === 1 && get4dom.body?.allTotal === 2, { total: get4dom.body?.total, domestic: get4dom.body?.domesticTotal, all: get4dom.body?.allTotal });

  // isCurrent 兜底：无 X-Device-Id 时用 token sid 匹配最后一条登录记录
  const get4NoHeader = await http("GET", "/mm/LoginRecords?scope=all", { token: dA.token });
  const items4NoHeader = get4NoHeader.body?.items ?? [];
  check(
    "GET（无 X-Device-Id）: 用 token sid 兜底判定 A isCurrent=true",
    get4NoHeader.status === 200 && itemById(items4NoHeader, devA?.id)?.isCurrent === true && itemById(items4NoHeader, devB?.id)?.isCurrent === false,
    { a: itemById(items4NoHeader, devA?.id)?.isCurrent, b: itemById(items4NoHeader, devB?.id)?.isCurrent },
  );

  // =========================================================================
  section("5. POST /mm/LoginRecords/active（token A + header A）→ A 活跃更新、B 不变");
  const aActiveBefore = devA?.lastActiveAt;
  const bActiveBefore = devB?.lastActiveAt;
  await sleep(1200);
  const activeA = await touchActive("A 上报活跃", { token: dA.token, deviceId: DEVICE_A, platform: "mp-weixin", device: "iPhone 13", userAgent: UA_WEIXIN_IPHONE });
  check(
    "POST /active（A）200 且返回 lastActiveAt",
    activeA.res.status === 200 && typeof activeA.res.body?.lastActiveAt === "string" && withinMinutes(parseApiUtc(activeA.res.body.lastActiveAt)),
    { status: activeA.res.status, body: activeA.res.body },
    apiRepro("POST", "/mm/LoginRecords/active", { token: true, headers: { "X-Device-Id": DEVICE_A } }),
  );
  await sleep(250);
  const devs5 = devices();
  const devA5 = devs5?.find((row) => row.id === devA?.id);
  const devB5 = devs5?.find((row) => row.id === devB?.id);
  check(
    "DB: A last_active_at 已更新（> 登录时间）",
    Boolean(devA5?.lastActiveAt && aActiveBefore && devA5.lastActiveAt > aActiveBefore),
    { before: aActiveBefore, after: devA5?.lastActiveAt },
    dbCmd(`SELECT last_active_at FROM user_login_devices WHERE id = ${devA?.id ?? 0};`),
  );
  check("DB: A last_active_at 与 POST /active 响应一致", tsEqual(parseApiUtc(activeA.res.body?.lastActiveAt), parseDbUtc(devA5?.lastActiveAt)), { api: activeA.res.body?.lastActiveAt, db: devA5?.lastActiveAt });
  check("DB: 上报 A 活跃不影响 B 的 last_active_at", Boolean(devB5?.lastActiveAt && bActiveBefore) && devB5.lastActiveAt === bActiveBefore, { before: bActiveBefore, after: devB5?.lastActiveAt });
  check("DB: POST /active 不写登录记录（records 仍 2）", recordCount() === 2, recordCount(), dbCmd(`SELECT COUNT(*) FROM user_login_records WHERE user_id = ${uid};`));
  check("DB: POST /active 不新增设备（devices 仍 2）", deviceCount() === 2, deviceCount());

  const get5 = await http("GET", "/mm/LoginRecords?scope=all", { token: dA.token, headers: { "X-Device-Id": DEVICE_A } });
  const items5 = get5.body?.items ?? [];
  check("GET（A 活跃后）: A 最新在前", Number(items5[0]?.deviceId) === devA?.id, items5.map((item) => item.deviceId));
  check("GET（A 活跃后）: A 项 lastActiveAt 已更新为最新值", tsEqual(parseApiUtc(itemById(items5, devA?.id)?.lastActiveAt), parseDbUtc(devA5?.lastActiveAt)), { api: itemById(items5, devA?.id)?.lastActiveAt, db: devA5?.lastActiveAt });

  // =========================================================================
  section("6. token B 上报活跃 → GET（token B，无 header）B isCurrent=true");
  const aActiveBeforeB = devA5?.lastActiveAt;
  await sleep(1200);
  const activeB = await touchActive("B 上报活跃", { token: dB.token, deviceId: DEVICE_B, platform: "h5", device: "Pixel 8", userAgent: UA_CHROME_ANDROID });
  check("POST /active（B）200", activeB.res.status === 200 && Boolean(activeB.res.body?.lastActiveAt), { status: activeB.res.status, body: activeB.res.body });
  await sleep(250);
  const devs6 = devices();
  const devA6 = devs6?.find((row) => row.id === devA?.id);
  const devB6 = devs6?.find((row) => row.id === devB?.id);
  check("DB: B last_active_at 已更新", Boolean(devB6?.lastActiveAt && bActiveBefore && devB6.lastActiveAt >= bActiveBefore), { before: bActiveBefore, after: devB6?.lastActiveAt });
  check("DB: 上报 B 活跃不影响 A（A 保持步骤 5 的值）", Boolean(devA6?.lastActiveAt && aActiveBeforeB) && devA6.lastActiveAt === aActiveBeforeB, { before: aActiveBeforeB, after: devA6?.lastActiveAt });

  const get6 = await http("GET", "/mm/LoginRecords?scope=all", { token: dB.token }); // 不带 X-Device-Id，走 sid 兜底
  const items6 = get6.body?.items ?? [];
  check("GET（token B，无 header）: B 最新在前", Number(items6[0]?.deviceId) === devB?.id, items6.map((item) => item.deviceId));
  check(
    "GET（token B，无 header）: sid 兜底判定 B isCurrent=true、A false",
    itemById(items6, devB?.id)?.isCurrent === true && itemById(items6, devA?.id)?.isCurrent === false,
    { b: itemById(items6, devB?.id)?.isCurrent, a: itemById(items6, devA?.id)?.isCurrent },
  );

  // =========================================================================
  section("7. POST /active 带未登录过的 X-Device-Id: verify-device-c → 新建设备 C（无登录记录）");
  const aActiveBeforeC = devA6?.lastActiveAt;
  const bActiveBeforeC = devB6?.lastActiveAt;
  await sleep(1200);
  const activeC = await touchActive("C 首次活跃（新设备）", { token: dA.token, deviceId: DEVICE_C, platform: "h5", device: "Desktop C", userAgent: UA_CHROME_DESKTOP });
  check(
    "POST /active（新设备 C）200 且返回 lastActiveAt",
    activeC.res.status === 200 && typeof activeC.res.body?.lastActiveAt === "string",
    { status: activeC.res.status, body: activeC.res.body },
    apiRepro("POST", "/mm/LoginRecords/active", { token: true, headers: { "X-Device-Id": DEVICE_C } }),
  );
  await sleep(250);
  const devs7 = devices();
  check("DB: 上报活跃后 devices = 3 台（新建 C）", Array.isArray(devs7) && devs7.length === 3, devs7?.length ?? schemaDetail(), dbCmd(`SELECT ${DEVICE_COLUMNS} FROM user_login_devices WHERE user_id = ${uid};`));
  const devC = devs7?.find((row) => row.deviceKey === DEVICE_C);
  const devA7 = devs7?.find((row) => row.id === devA?.id);
  const devB7 = devs7?.find((row) => row.id === devB?.id);
  check("DB: 新设备 C device_key = verify-device-c", devC?.deviceKey === DEVICE_C, devC?.deviceKey);
  check("DB: 新设备 C device='Desktop C' / platform=h5", devC?.device === "Desktop C" && devC?.platform === "h5", { device: devC?.device, platform: devC?.platform });
  check("DB: 新设备 C last_login_record_id 为 NULL（无登录记录）", devC?.lastLoginRecordId === null, devC?.lastLoginRecordId, dbCmd(`SELECT last_login_record_id FROM user_login_devices WHERE id = ${devC?.id ?? 0};`));
  check("DB: 新设备 C first_login_at == last_login_at == last_active_at（活跃创建）", Boolean(devC && devC.firstLoginAt && devC.lastLoginAt && devC.lastActiveAt) && devC.firstLoginAt === devC.lastLoginAt && tsEqual(parseDbUtc(devC.lastLoginAt), parseDbUtc(devC.lastActiveAt)), { first: devC?.firstLoginAt, last: devC?.lastLoginAt, active: devC?.lastActiveAt });
  check("DB: 上报 C 活跃不写登录记录（records 仍 2）", recordCount() === 2, recordCount());
  check("DB: 上报 C 活跃不影响 A/B 的 last_active_at", Boolean(devA7?.lastActiveAt && aActiveBeforeC && devB7?.lastActiveAt && bActiveBeforeC) && devA7.lastActiveAt === aActiveBeforeC && devB7.lastActiveAt === bActiveBeforeC, { a: { before: aActiveBeforeC, after: devA7?.lastActiveAt }, b: { before: bActiveBeforeC, after: devB7?.lastActiveAt } });

  const get7 = await http("GET", "/mm/LoginRecords?scope=all", { token: dA.token, headers: { "X-Device-Id": DEVICE_C } });
  const items7 = get7.body?.items ?? [];
  check("GET（header C）: 3 项，C 最新在前", items7.length === 3 && Number(items7[0]?.deviceId) === devC?.id, { ids: items7.map((item) => item.deviceId), expectFirst: devC?.id });
  check(
    "GET（header C）: header 优先 → C isCurrent=true、A/B false",
    itemById(items7, devC?.id)?.isCurrent === true && itemById(items7, devA?.id)?.isCurrent === false && itemById(items7, devB?.id)?.isCurrent === false,
    { c: itemById(items7, devC?.id)?.isCurrent, a: itemById(items7, devA?.id)?.isCurrent, b: itemById(items7, devB?.id)?.isCurrent },
  );
  const itemC7 = itemById(items7, devC?.id);
  check("GET: C 项 deviceId/device/platform 与 DB 一致", itemC7?.deviceId !== undefined && itemC7.device === "Desktop C" && itemC7.platform === "h5", { deviceId: itemC7?.deviceId, device: itemC7?.device, platform: itemC7?.platform });
  check(
    "GET: C 项 loginAt 兜底为设备 last_login_at / lastActiveAt 与 DB 一致",
    tsEqual(parseApiUtc(itemC7?.loginAt), parseDbUtc(devC?.lastLoginAt)) && tsEqual(parseApiUtc(itemC7?.lastActiveAt), parseDbUtc(devC?.lastActiveAt)),
    { loginAt: itemC7?.loginAt, dbLogin: devC?.lastLoginAt, lastActiveAt: itemC7?.lastActiveAt, dbActive: devC?.lastActiveAt },
  );
  check(
    "GET: C 项无登录记录 → location/ipMasked/province/city 为 null、loginType 为空",
    itemC7 !== undefined && itemC7.location === null && itemC7.ipMasked === null && itemC7.province == null && itemC7.city == null && !itemC7.loginType,
    { location: itemC7?.location, ipMasked: itemC7?.ipMasked, province: itemC7?.province, city: itemC7?.city, loginType: itemC7?.loginType },
  );
  check("GET: C 项 isDomestic=false", itemC7?.isDomestic === false, itemC7?.isDomestic);

  const get7A = await http("GET", "/mm/LoginRecords?scope=all", { token: dA.token, headers: { "X-Device-Id": DEVICE_A } });
  check("GET（header A）: A isCurrent=true、C false（isCurrent 依请求头）", itemById(get7A.body?.items, devA?.id)?.isCurrent === true && itemById(get7A.body?.items, devC?.id)?.isCurrent === false, { a: itemById(get7A.body?.items, devA?.id)?.isCurrent, c: itemById(get7A.body?.items, devC?.id)?.isCurrent });

  const get7dom = await http("GET", "/mm/LoginRecords?scope=domestic", { token: dA.token, headers: { "X-Device-Id": DEVICE_A } });
  check(
    "GET domestic: 只有 A 1 项（C 无登录记录、B 境外），计数 1/1/3",
    get7dom.body?.total === 1 && get7dom.body?.domesticTotal === 1 && get7dom.body?.allTotal === 3 && Number(get7dom.body?.items?.[0]?.deviceId) === devA?.id,
    { total: get7dom.body?.total, domestic: get7dom.body?.domesticTotal, all: get7dom.body?.allTotal, ids: get7dom.body?.items?.map((item) => item.deviceId) },
  );
  check(
    "GET: 3 项均不含 status/logoutAt",
    Array.isArray(items7) && items7.length === 3 && items7.every((item) => !hasOwn(item, "status") && !hasOwn(item, "logoutAt")),
    items7.map((item) => Object.keys(item)),
  );

  // =========================================================================
  section("8. GET 契约回归：默认参数 / scope / 分页夹取 / 401");
  const dflt = await http("GET", "/mm/LoginRecords", { token: dA.token, headers: { "X-Device-Id": DEVICE_A } });
  check("不传 scope 默认 domestic", dflt.status === 200 && dflt.body?.scope === "domestic", { status: dflt.status, scope: dflt.body?.scope }, apiRepro("GET", "/mm/LoginRecords", { token: true }));
  check("默认 page=1 / pageSize=20", dflt.body?.page === 1 && dflt.body?.pageSize === 20, { page: dflt.body?.page, pageSize: dflt.body?.pageSize });

  const invalidScope = await http("GET", "/mm/LoginRecords?scope=bogus", { token: dA.token, headers: { "X-Device-Id": DEVICE_A } });
  check("非法 scope 按 domestic 处理", invalidScope.status === 200 && invalidScope.body?.scope === "domestic" && invalidScope.body?.total === 1, { status: invalidScope.status, scope: invalidScope.body?.scope, total: invalidScope.body?.total });

  const bigSize = await http("GET", "/mm/LoginRecords?scope=all&pageSize=999", { token: dA.token, headers: { "X-Device-Id": DEVICE_A } });
  check("pageSize=999 夹到 50", bigSize.status === 200 && bigSize.body?.pageSize === 50, bigSize.body?.pageSize);
  const page1 = await http("GET", "/mm/LoginRecords?scope=all&pageSize=1&page=1", { token: dA.token, headers: { "X-Device-Id": DEVICE_A } });
  check("pageSize=1&page=1 返回最新设备 C", page1.status === 200 && page1.body?.pageSize === 1 && page1.body?.items?.length === 1 && Number(page1.body.items[0].deviceId) === devC?.id && page1.body?.total === 3, { ids: page1.body?.items?.map((item) => item.deviceId), total: page1.body?.total });
  const page2 = await http("GET", "/mm/LoginRecords?scope=all&pageSize=1&page=2", { token: dA.token, headers: { "X-Device-Id": DEVICE_A } });
  check("pageSize=1&page=2 返回第二台设备 B", page2.status === 200 && page2.body?.items?.length === 1 && Number(page2.body.items[0].deviceId) === devB?.id, page2.body?.items?.map((item) => item.deviceId));
  const page3 = await http("GET", "/mm/LoginRecords?scope=all&pageSize=1&page=3", { token: dA.token, headers: { "X-Device-Id": DEVICE_A } });
  check("pageSize=1&page=3 返回第三台设备 A", page3.status === 200 && page3.body?.items?.length === 1 && Number(page3.body.items[0].deviceId) === devA?.id, page3.body?.items?.map((item) => item.deviceId));
  const pageZero = await http("GET", "/mm/LoginRecords?scope=all&page=0", { token: dA.token, headers: { "X-Device-Id": DEVICE_A } });
  check("page=0 夹到 1", pageZero.status === 200 && pageZero.body?.page === 1, { status: pageZero.status, page: pageZero.body?.page });
  const sizeZero = await http("GET", "/mm/LoginRecords?scope=all&pageSize=0", { token: dA.token, headers: { "X-Device-Id": DEVICE_A } });
  check("pageSize=0 夹到 1", sizeZero.status === 200 && sizeZero.body?.pageSize === 1, { status: sizeZero.status, pageSize: sizeZero.body?.pageSize });
  const beyond = await http("GET", "/mm/LoginRecords?scope=all&page=99", { token: dA.token, headers: { "X-Device-Id": DEVICE_A } });
  check("超出范围页返回空 items、total 不变", beyond.status === 200 && Array.isArray(beyond.body?.items) && beyond.body.items.length === 0 && beyond.body.total === 3, { items: beyond.body?.items?.length, total: beyond.body?.total });

  // =========================================================================
  section("9. 迁移数据只读复核（user 11 快照前后一致）");
  const migrationAfter = migrationSnapshot();
  check(
    `用户 ${MIGRATION_USER_ID} 迁移数据未被测试改动（快照一致）`,
    migrationBefore !== null && migrationAfter !== null && JSON.stringify(migrationBefore) === JSON.stringify(migrationAfter),
    { before: migrationBefore, after: migrationAfter },
    dbCmd(`SELECT id, last_login_at, last_active_at FROM user_login_devices WHERE user_id = ${MIGRATION_USER_ID};`),
  );
} catch (error) {
  failures.push({ label: `脚本异常中断：${error.message.split("\n")[0]}` });
  console.error(`\n  FATAL  ${error.stack ?? error.message}`);
} finally {
  section("清理：删除临时测试用户（devices/records 级联）+ Redis 标记");
  const cleanupProblems = cleanupTestData();
  for (const problem of cleanupProblems) {
    failures.push({ label: `清理：${problem}` });
    console.log(`  FAIL  清理：${problem}`);
  }
  if (cleanupProblems.length === 0) console.log("  PASS  测试数据已清理干净（用户 / 设备 / 记录 / Redis 标记）");

  console.log(
    `\n===== 结果：${failures.length === 0 ? "全部通过" : `${failures.length} 项失败`}` +
      `（PASS ${passCount} / FAIL ${failures.length}）=====`,
  );
  if (failures.length > 0) {
    console.log("\n失败清单（复现命令）：");
    for (const failure of failures) {
      console.log(`  ✗ ${failure.label}`);
      if (failure.repro) console.log(`    复现: ${failure.repro}`);
    }
    console.log(`\n提示：重跑可指定目标后端：DEV_VERIFY_API=${API} node tools/dev-verify/verify-login-records.mjs`);
  }
  console.log(`\n目标: ${API}`);
  process.exit(failures.length === 0 ? 0 : 1);
}
