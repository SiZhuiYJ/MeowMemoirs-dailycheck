/**
 * 验证「登录记录」功能（设计契约：/data/data/com.termux/files/home/tmp/login-records-design.md 第 4 节 A）。
 *
 * 覆盖：
 *   1. 临时测试用户（PBKDF2-SHA256 / 16B salt / 100000 轮 / 32B key，与 PasswordHasher.cs 同格式）
 *   2. 国内登录（X-Forwarded-For: 222.137.1.1 + X-Client-Platform / X-Client-Device）→ DB 落库断言
 *   3. 境外登录（8.8.8.8）→ is_domestic=0 / location='境外'
 *   4. GET /mm/LoginRecords：scope 过滤 / 三个计数 / status / 脱敏 / 分页夹取 / 401
 *   5. 登出（logout）后旧 token 401、记录状态变 logged_out；重新登录后旧记录 logged_out
 *   6. logout-all 全端登出后所有记录 logged_out，且新登录恢复正常
 *   7. refresh 不产生新的登录记录（sid 沿用）
 *
 * 运行（默认指向本机 dev 实例 5211；可用 DEV_VERIFY_API 覆盖）：
 *   node tools/dev-verify/verify-login-records.mjs
 *   DEV_VERIFY_API=http://127.0.0.1:5211 node tools/dev-verify/verify-login-records.mjs
 *
 * 副作用（会清理干净）：
 *   · 临时创建 verify-login-records@example.test，结束后删除：
 *     user_login_records 由 FK ON DELETE CASCADE 带走（删完会校验，残留则兜底删除并报告）；
 *   · 清理该用户的 Redis 令牌 / 撤销标记（access_token / refresh_token / auth_revoked_before / revoked_sid）。
 *   不读写任何已有用户的数据。
 *
 * 凭据：只从 config.mjs（其内部读 api/appsettings.Development.json）取，不写死。
 */
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { API as CONFIG_API, dbq, dbExec, rcli } from "./config.mjs";

/**
 * 目标后端：
 *   · config.mjs 的 API 取自 api/appsettings.json 的 Kestrel 端口（= 5210，runit 生产实例，
 *     本特性集成期间仍是旧代码），直接用它会把 e2e 打到旧代码上得到 404；
 *   · 本套件验证的是「Lead 统一重启的 dev 实例」（5211），因此默认 5211；
 *   · 需要换环境用 DEV_VERIFY_API 覆盖。
 */
const API = process.env.DEV_VERIFY_API ?? "http://127.0.0.1:5211";

const EMAIL = "verify-login-records@example.test";
const USER_ACCOUNT = "verify_login_records";
const PASSWORD = "Verify-Login-Records-2026!";

// 国内：222.137.1.1 = 河南郑州联通（GeoCN 命中）
const CN_XFF = "222.137.1.1";
const CN_PROVINCE = "河南";
const CN_CITY = "郑州";
const CN_LOCATION = "河南 · 郑州";
// 境外：Google DNS，GeoCN 不命中
const OVERSEAS_XFF = "8.8.8.8";
// 境外 IPv6：验证 ip varchar(45) + IPv6 脱敏（只留前两组）
const OVERSEAS_V6_XFF = "2001:4860:4860::8888";

const UA_WEIXIN_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) " +
  "Mobile/15E148 MicroMessenger/8.0.49(0x18003128) NetType/WIFI Language/zh_CN";
const UA_WEIXIN_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; 23127PN0CC) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/122.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.49";

// ---------------------------------------------------------------------------
// 断言框架（PASS/FAIL 汇总 + 失败可复现命令 + 非 0 退出码）
// ---------------------------------------------------------------------------
let passCount = 0;
const failures = [];
let uid = null; // 测试用户 id（插入后赋值）
let canUseRecords = false; // user_login_records 表是否可用
const sids = []; // 本次登录产生过的设备会话 sid（用于清理 revoked_sid:*）

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
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
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
// HTTP / JWT 小工具
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
// DB 小工具（SQL 用 -N -B，NULL 输出为字面量 NULL）
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
function findUserIdByEmail() {
  const value = dbq(`SELECT id FROM users WHERE email = ${sqlStr(EMAIL)} LIMIT 1`);
  return value === "" ? null : Number(value);
}

const RECORD_COLUMNS = [
  "id",
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

function mapRecord(row) {
  return {
    id: Number(row[0]),
    sessionId: row[1],
    loginType: row[2],
    platform: row[3],
    device: row[4],
    userAgent: row[5],
    ip: row[6],
    location: row[7],
    province: row[8],
    city: row[9],
    district: row[10],
    isp: row[11],
    isDomestic: row[12],
    loginAt: row[13],
    logoutAt: row[14],
  };
}

/** 查本次测试用户的登录记录（按 id 升序）；表不可用/查询失败返回 null。 */
function records(where = `user_id = ${uid}`) {
  if (!canUseRecords || uid === null) return null;
  try {
    return dbRows(`SELECT ${RECORD_COLUMNS} FROM user_login_records WHERE ${where} ORDER BY id ASC`).map(mapRecord);
  } catch {
    return null;
  }
}
function latestRecord() {
  const rows = records();
  return rows && rows.length ? rows[rows.length - 1] : null;
}
function recordById(id) {
  if (!Number.isFinite(Number(id))) return null;
  const rows = records(`user_id = ${uid} AND id = ${Number(id)}`);
  return rows && rows.length ? rows[0] : null;
}
function recordCount() {
  if (!canUseRecords || uid === null) return null;
  try {
    return Number(dbScalar(`SELECT COUNT(*) FROM user_login_records WHERE user_id = ${uid}`) ?? "0");
  } catch {
    return null;
  }
}
function dbDetail(fallback) {
  return canUseRecords
    ? fallback
    : `user_login_records 表不存在（先执行 sql/2026-11-18_user_login_records.sql）`;
}

// 时间：DB 里是 UTC（无时区），API 契约示例带 Z；按 UTC 解析，缺时区也按 UTC 处理。
function parseDbUtc(value) {
  return value ? Date.parse(`${value.replace(" ", "T")}Z`) : Number.NaN;
}
function parseApiUtc(value) {
  if (typeof value !== "string" || !value) return Number.NaN;
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`);
}
const withinMinutes = (timestamp, minutes = 5) =>
  Number.isFinite(timestamp) && Math.abs(Date.now() - timestamp) <= minutes * 60_000;
const findItem = (items, id) =>
  Array.isArray(items) ? items.find((item) => Number(item?.id) === Number(id)) : undefined;

// ---------------------------------------------------------------------------
// 测试用户准备 / 清理
// ---------------------------------------------------------------------------
/** 与 api/Infrastructure/PasswordHasher.cs 完全一致的哈希格式：base64(16B salt):base64(32B key)。 */
function hashPassword(password) {
  const salt = randomBytes(16);
  const key = pbkdf2Sync(password, salt, 100_000, 32, "sha256");
  return `${salt.toString("base64")}:${key.toString("base64")}`;
}

function resetStaleTestData() {
  try {
    const staleUid = findUserIdByEmail();
    if (staleUid === null) return;
    try {
      rcli("del", `access_token:${staleUid}`, `refresh_token:${staleUid}`, `auth_revoked_before:${staleUid}`);
    } catch {
      /* Redis 不可用也继续，删库才是关键 */
    }
    dbExec(`DELETE FROM users WHERE id = ${staleUid}`);
    console.log(`  INFO  已清理上次残留的测试用户 id=${staleUid}`);
  } catch (error) {
    console.log(`  INFO  清理上次残留失败（继续）：${error.message.split("\n")[0]}`);
  }
}

/** 先删 Redis 标记，再删用户（FK CASCADE 带走登录记录），最后校验无残留。 */
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
      const keys = [
        `access_token:${targetUid}`,
        `refresh_token:${targetUid}`,
        `auth_revoked_before:${targetUid}`,
        ...sids.map((sid) => `revoked_sid:${sid}`),
      ];
      rcli("del", ...keys);
    } catch (error) {
      problems.push(`Redis 清理失败：${error.message.split("\n")[0]}`);
    }

    try {
      dbExec(`DELETE FROM users WHERE id = ${targetUid}`);
      if (tableExists("user_login_records")) {
        const orphan = Number(dbScalar(`SELECT COUNT(*) FROM user_login_records WHERE user_id = ${targetUid}`) ?? "0");
        if (orphan > 0) {
          problems.push(`FK CASCADE 未生效：删用户后仍残留 ${orphan} 条登录记录（已兜底删除）`);
          dbExec(`DELETE FROM user_login_records WHERE user_id = ${targetUid}`);
        }
      }
    } catch (error) {
      problems.push(`数据库清理失败：${error.message.split("\n")[0]}`);
    }
  }

  // 兜底：按邮箱再删一次（覆盖 uid 未知/插入半途失败的情况）
  try {
    dbExec(`DELETE FROM users WHERE email = ${sqlStr(EMAIL)}`);
  } catch (error) {
    problems.push(`兜底删除测试用户失败：${error.message.split("\n")[0]}`);
  }

  try {
    const remainUsers = Number(dbScalar(`SELECT COUNT(*) FROM users WHERE email = ${sqlStr(EMAIL)}`) ?? "0");
    if (remainUsers !== 0) problems.push(`清理后仍残留 ${remainUsers} 个测试用户`);
    if (tableExists("user_login_records") && targetUid !== null) {
      const remainRecords = Number(
        dbScalar(`SELECT COUNT(*) FROM user_login_records WHERE user_id = ${targetUid}`) ?? "0",
      );
      if (remainRecords !== 0) problems.push(`清理后仍残留 ${remainRecords} 条登录记录`);
    }
  } catch (error) {
    problems.push(`清理校验失败：${error.message.split("\n")[0]}`);
  }

  return problems;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
console.log(`\n目标后端: ${API}${process.env.DEV_VERIFY_API ? "" : "（默认：本机 dev 实例）"}`);
if (CONFIG_API !== API) {
  console.log(
    `说明: config.mjs 的 API=${CONFIG_API} 来自 appsettings.json 的 Kestrel（runit 生产实例/旧代码）；` +
      "本套件默认 5211，可用 DEV_VERIFY_API 覆盖。",
  );
}
console.log(`测试用户: ${EMAIL}（脚本结束会删除）`);

try {
  // =========================================================================
  section("0. 预检");
  const ping = await http("GET", "/mm/Auth/me");
  check("API 可达（GET /mm/Auth/me 无 token → 401）", ping.status === 401, {
    status: ping.status,
    error: ping.error,
  });
  if (ping.status === 0) {
    throw new Error(`API 不可达：${API}（${ping.error}）`);
  }
  canUseRecords = tableExists("user_login_records");
  check(
    "user_login_records 表已创建（增量脚本已执行）",
    canUseRecords,
    canUseRecords ? "存在" : "缺表：先执行 sql/2026-11-18_user_login_records.sql",
    dbCmd("SHOW TABLES LIKE 'user_login_records';"),
  );
  const noToken = await http("GET", "/mm/LoginRecords");
  check("GET /mm/LoginRecords 未带 token → 401", noToken.status === 401, {
    status: noToken.status,
    body: noToken.body,
  });
  if (noToken.status === 404) {
    console.log("  NOTE  接口 404：dev API 还是旧代码（等 Lead 重启 dev API 后再跑 e2e）；本次按 dry-run 继续。");
  }

  // =========================================================================
  section("1. 临时测试用户（PBKDF2 哈希与 PasswordHasher.cs 同格式）");
  resetStaleTestData();
  const passwordHash = hashPassword(PASSWORD);
  check(
    "PBKDF2 哈希格式 base64(16B salt):base64(32B key)",
    /^[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]{43}=$/.test(passwordHash),
    "salt 16B / key 32B / SHA256 / 100000 轮",
  );
  dbExec(
    `INSERT INTO users (email, password_hash, nick_name, user_account, status, role) VALUES (` +
      `${sqlStr(EMAIL)}, ${sqlStr(passwordHash)}, '验证-登录记录', ${sqlStr(USER_ACCOUNT)}, 1, 'user')`,
  );
  uid = findUserIdByEmail();
  check("测试用户已写入 users", Number.isInteger(uid) && uid > 0, { uid });
  if (uid === null) throw new Error("测试用户插入失败，无法继续");

  // =========================================================================
  section("2. 国内登录：X-Forwarded-For=222.137.1.1 + 设备头 → DB 落库");
  const login1 = await http("POST", "/mm/Auth/login", {
    headers: {
      "X-Forwarded-For": CN_XFF,
      "X-Client-Platform": "mp-weixin",
      "X-Client-Device": "iPhone 13",
      "User-Agent": UA_WEIXIN_IPHONE,
    },
    body: { email: EMAIL, password: PASSWORD },
  });
  check("国内登录 200 且返回 access token", login1.status === 200 && Boolean(login1.body?.token), {
    status: login1.status,
    body: login1.status === 200 ? undefined : login1.body,
  });
  if (login1.status !== 200) throw new Error(`测试用户登录失败（${login1.status}）：哈希格式或账号状态异常`);
  const payload1 = decodeJwt(login1.body.token);
  const sid1 = payload1?.sid;
  if (sid1) sids.push(sid1);
  check("登录响应 userId 是测试用户", Number(login1.body?.userId) === uid, { userId: login1.body?.userId, uid });
  check("access token 带 sid 声明", typeof sid1 === "string" && sid1.length > 0, { sid: sid1 });

  const r1 = latestRecord();
  info(
    r1
      ? `DB 记录 R1: ${JSON.stringify({
          id: r1.id,
          ip: r1.ip,
          location: r1.location,
          device: r1.device,
          platform: r1.platform,
          isDomestic: r1.isDomestic,
          sessionId: r1.sessionId,
        })}`
      : dbDetail("DB 无记录：登录钩子未生效"),
  );
  check(
    "DB: 登录成功写入 user_login_records",
    r1 !== null,
    r1 ? { id: r1.id, ip: r1.ip, location: r1.location } : dbDetail("无记录（RecordLoginAsync 未生效）"),
    dbCmd(`SELECT ${RECORD_COLUMNS} FROM user_login_records WHERE user_id = ${uid};`),
  );
  if (r1) {
    check("DB: login_type=password", r1.loginType === "password", r1.loginType, dbCmd(`SELECT login_type FROM user_login_records WHERE id = ${r1.id};`));
    check("DB: session_id == token.sid", r1.sessionId === sid1, { db: r1.sessionId, token: sid1 }, dbCmd(`SELECT session_id FROM user_login_records WHERE id = ${r1.id};`));
    check("DB: ip=222.137.1.1", r1.ip === CN_XFF, r1.ip, dbCmd(`SELECT ip FROM user_login_records WHERE id = ${r1.id};`));
    check("DB: is_domestic=1", r1.isDomestic === "1", r1.isDomestic, dbCmd(`SELECT is_domestic FROM user_login_records WHERE id = ${r1.id};`));
    check("DB: province=河南", r1.province === CN_PROVINCE, r1.province, dbCmd(`SELECT province FROM user_login_records WHERE id = ${r1.id};`));
    check("DB: city=郑州", r1.city === CN_CITY, r1.city, dbCmd(`SELECT city FROM user_login_records WHERE id = ${r1.id};`));
    check("DB: location='河南 · 郑州'", r1.location === CN_LOCATION, r1.location, dbCmd(`SELECT location FROM user_login_records WHERE id = ${r1.id};`));
    check("DB: isp 含「联通」", typeof r1.isp === "string" && r1.isp.includes("联通"), r1.isp, dbCmd(`SELECT isp FROM user_login_records WHERE id = ${r1.id};`));
    check("DB: platform=mp-weixin", r1.platform === "mp-weixin", r1.platform, dbCmd(`SELECT platform FROM user_login_records WHERE id = ${r1.id};`));
    check("DB: device='iPhone 13 · 微信'", r1.device === "iPhone 13 · 微信", r1.device, dbCmd(`SELECT device FROM user_login_records WHERE id = ${r1.id};`));
    check("DB: user_agent 完整入库（<512 不截断）", r1.userAgent === UA_WEIXIN_IPHONE, r1.userAgent?.slice(0, 60), dbCmd(`SELECT user_agent FROM user_login_records WHERE id = ${r1.id};`));
    check("DB: logout_at 为空", r1.logoutAt === null, r1.logoutAt, dbCmd(`SELECT logout_at FROM user_login_records WHERE id = ${r1.id};`));
    check("DB: login_at 是近 5 分钟内的 UTC 时间", withinMinutes(parseDbUtc(r1.loginAt)), r1.loginAt, dbCmd(`SELECT login_at FROM user_login_records WHERE id = ${r1.id};`));
  }

  // =========================================================================
  section("3. 境外登录：X-Forwarded-For=8.8.8.8 + h5 设备头 → DB 落库；refresh 不记录");
  const login2 = await http("POST", "/mm/Auth/login", {
    headers: {
      "X-Forwarded-For": OVERSEAS_XFF,
      "X-Client-Platform": "h5",
      "X-Client-Device": "Pixel 8",
      "User-Agent": UA_WEIXIN_ANDROID,
    },
    body: { email: EMAIL, password: PASSWORD },
  });
  check("境外登录 200", login2.status === 200 && Boolean(login2.body?.token), { status: login2.status, body: login2.status === 200 ? undefined : login2.body });
  const payload2 = decodeJwt(login2.body?.token);
  const sid2 = payload2?.sid;
  if (sid2) sids.push(sid2);

  const r2 = latestRecord();
  info(
    r2
      ? `DB 记录 R2: ${JSON.stringify({
          id: r2.id,
          ip: r2.ip,
          location: r2.location,
          device: r2.device,
          platform: r2.platform,
          isDomestic: r2.isDomestic,
          sessionId: r2.sessionId,
        })}`
      : dbDetail("DB 无记录"),
  );
  check("DB: 境外登录写入第二条记录", r2 !== null && r2.id !== r1?.id, r2 ? { id: r2.id } : dbDetail("无记录"));
  if (r2) {
    check("DB: R2 session_id == token.sid", r2.sessionId === sid2, { db: r2.sessionId, token: sid2 });
    check("DB: R2 ip=8.8.8.8", r2.ip === OVERSEAS_XFF, r2.ip);
    check("DB: R2 is_domestic=0", r2.isDomestic === "0", r2.isDomestic);
    check("DB: R2 location='境外'", r2.location === "境外", r2.location);
    check("DB: R2 province/city 未设置", r2.province == null && r2.city == null, { province: r2.province, city: r2.city });
    check("DB: R2 platform=h5", r2.platform === "h5", r2.platform);
    check("DB: R2 device='Pixel 8'（h5 不加平台后缀）", r2.device === "Pixel 8", r2.device);
    check("DB: R2 login_type=password", r2.loginType === "password", r2.loginType);
    check("DB: R2 logout_at 为空", r2.logoutAt === null, r2.logoutAt);
  }

  // refresh 是同一设备续期，不应新增登录记录
  const refreshed = await http("POST", "/mm/Auth/refresh", { body: { refreshToken: login2.body?.refreshToken } });
  check("POST /mm/Auth/refresh 200", refreshed.status === 200, { status: refreshed.status, body: refreshed.status === 200 ? undefined : refreshed.body });
  if (refreshed.status === 200) {
    check("refresh 沿用同一设备 sid", decodeJwt(refreshed.body?.token)?.sid === sid2, {
      before: sid2,
      after: decodeJwt(refreshed.body?.token)?.sid,
    });
  }
  check("refresh 不产生新的登录记录", recordCount() === 2, { count: recordCount() }, dbCmd(`SELECT COUNT(*) FROM user_login_records WHERE user_id = ${uid};`));

  // =========================================================================
  section("4. GET /mm/LoginRecords：scope / 计数 / status / 脱敏 / 分页 / 401");
  const token2 = login2.body.token;
  const dflt = await http("GET", "/mm/LoginRecords", { token: token2 });
  check("不传 scope 默认 domestic", dflt.status === 200 && dflt.body?.scope === "domestic", {
    status: dflt.status,
    scope: dflt.body?.scope,
  }, apiRepro("GET", "/mm/LoginRecords", { token: true }));

  const domestic = await http("GET", "/mm/LoginRecords?scope=domestic", { token: token2 });
  check("scope=domestic 200", domestic.status === 200, { status: domestic.status, body: domestic.status === 200 ? undefined : domestic.body }, apiRepro("GET", "/mm/LoginRecords?scope=domestic", { token: true }));
  const dBody = domestic.body ?? {};
  check("默认 page=1 / pageSize=20", dBody.page === 1 && dBody.pageSize === 20, { page: dBody.page, pageSize: dBody.pageSize });
  check("domestic: total=1", dBody.total === 1, dBody.total);
  check("domestic: domesticTotal=1", dBody.domesticTotal === 1, dBody.domesticTotal);
  check("domestic: allTotal=2", dBody.allTotal === 2, dBody.allTotal);
  check("domestic: items 只含 1 条国内记录", Array.isArray(dBody.items) && dBody.items.length === 1 && Number(dBody.items[0]?.id) === r1?.id, {
    ids: dBody.items?.map((item) => item.id),
  });
  const dItem = dBody.items?.[0] ?? {};
  check("item: location='河南 · 郑州'", dItem.location === CN_LOCATION, dItem.location);
  check("item: ipMasked='222.137.*.*'", dItem.ipMasked === "222.137.*.*", dItem.ipMasked);
  check("item: isDomestic=true", dItem.isDomestic === true, dItem.isDomestic);
  check("item: status=active（未登出）", dItem.status === "active", dItem.status);
  check("item: loginType=password", dItem.loginType === "password", dItem.loginType);
  check("item: device='iPhone 13 · 微信'", dItem.device === "iPhone 13 · 微信", dItem.device);
  check("item: platform=mp-weixin", dItem.platform === "mp-weixin", dItem.platform);
  check("item: province=河南 / city=郑州", dItem.province === CN_PROVINCE && dItem.city === CN_CITY, { province: dItem.province, city: dItem.city });
  check("item: loginAt 是近 5 分钟内的 UTC 时间", withinMinutes(parseApiUtc(dItem.loginAt)), dItem.loginAt);
  check("item: logoutAt=null", dItem.logoutAt === null, dItem.logoutAt);

  const all = await http("GET", "/mm/LoginRecords?scope=all", { token: token2 });
  check("scope=all 200", all.status === 200, { status: all.status, body: all.status === 200 ? undefined : all.body });
  const aBody = all.body ?? {};
  check("all: total=2 / domesticTotal=1 / allTotal=2", aBody.total === 2 && aBody.domesticTotal === 1 && aBody.allTotal === 2, {
    total: aBody.total,
    domesticTotal: aBody.domesticTotal,
    allTotal: aBody.allTotal,
  });
  const aItems = Array.isArray(aBody.items) ? aBody.items : [];
  check("all: 2 条且按 login_at DESC, id DESC 排序（新的在前）", aItems.length === 2 && Number(aItems[0]?.id) === r2?.id && Number(aItems[1]?.id) === r1?.id, aItems.map((item) => item.id));
  const aLatest = aItems[0] ?? {};
  check("all item[0]（境外）: location=境外 / isDomestic=false / ipMasked='8.8.*.*'", aLatest.location === "境外" && aLatest.isDomestic === false && aLatest.ipMasked === "8.8.*.*", {
    location: aLatest.location,
    isDomestic: aLatest.isDomestic,
    ipMasked: aLatest.ipMasked,
  });
  check("all item[0]: status=current（session_id == 当前 token 的 sid）", aLatest.status === "current", aLatest.status);
  check("all item[0]: province/city 未设置", aLatest.id !== undefined && aLatest.province == null && aLatest.city == null, { province: aLatest.province, city: aLatest.city });
  check("all item[1]: status=active（未登出）", aItems[1]?.status === "active", aItems[1]?.status);

  const invalidScope = await http("GET", "/mm/LoginRecords?scope=bogus", { token: token2 });
  check("非法 scope 按 domestic 处理", invalidScope.status === 200 && invalidScope.body?.scope === "domestic" && invalidScope.body?.total === 1, {
    status: invalidScope.status,
    scope: invalidScope.body?.scope,
    total: invalidScope.body?.total,
  });

  const bigSize = await http("GET", "/mm/LoginRecords?scope=all&pageSize=999", { token: token2 });
  check("pageSize=999 夹到 50", bigSize.status === 200 && bigSize.body?.pageSize === 50, bigSize.body?.pageSize);
  const page1 = await http("GET", "/mm/LoginRecords?scope=all&pageSize=1&page=1", { token: token2 });
  check("pageSize=1&page=1 只返回最新 1 条", page1.status === 200 && page1.body?.pageSize === 1 && page1.body?.items?.length === 1 && Number(page1.body.items[0].id) === r2?.id && page1.body?.total === 2, {
    status: page1.status,
    pageSize: page1.body?.pageSize,
    ids: page1.body?.items?.map((item) => item.id),
  });
  const page2 = await http("GET", "/mm/LoginRecords?scope=all&pageSize=1&page=2", { token: token2 });
  check("pageSize=1&page=2 返回第 2 条", page2.status === 200 && page2.body?.items?.length === 1 && Number(page2.body.items[0].id) === r1?.id, {
    ids: page2.body?.items?.map((item) => item.id),
  });
  const pageZero = await http("GET", "/mm/LoginRecords?scope=all&page=0", { token: token2 });
  check("page=0 夹到 1", pageZero.status === 200 && pageZero.body?.page === 1, { status: pageZero.status, page: pageZero.body?.page });
  const sizeZero = await http("GET", "/mm/LoginRecords?scope=all&pageSize=0", { token: token2 });
  check("pageSize=0 夹到 1", sizeZero.status === 200 && sizeZero.body?.pageSize === 1, { status: sizeZero.status, pageSize: sizeZero.body?.pageSize });
  const beyond = await http("GET", "/mm/LoginRecords?scope=all&page=99", { token: token2 });
  check("超出范围页返回空 items、total 不变", beyond.status === 200 && Array.isArray(beyond.body?.items) && beyond.body.items.length === 0 && beyond.body.total === 2, {
    items: beyond.body?.items?.length,
    total: beyond.body?.total,
  });

  // =========================================================================
  section("5. status 判定：Redis revoked_sid 也纳入（不只 DB logout_at）");
  const r1Before = recordById(r1?.id);
  check("前置：R1 logout_at 仍为 NULL（没有真实登出）", r1Before?.logoutAt === null, r1Before?.logoutAt);
  try {
    rcli("set", `revoked_sid:${sid1}`, "1");
    const revoked = await http("GET", "/mm/LoginRecords?scope=all", { token: token2 });
    const revokedItem = findItem(revoked.body?.items, r1?.id);
    check("Redis revoked_sid 存在时该条 status=logged_out", revokedItem?.status === "logged_out", revokedItem?.status);
    check("判定来自 Redis，不改 DB logout_at", recordById(r1?.id)?.logoutAt === null, recordById(r1?.id)?.logoutAt);
    rcli("del", `revoked_sid:${sid1}`);
    const back = await http("GET", "/mm/LoginRecords?scope=all", { token: token2 });
    check("清理 revoked_sid 后恢复 active", findItem(back.body?.items, r1?.id)?.status === "active", findItem(back.body?.items, r1?.id)?.status);
  } catch (error) {
    check("Redis 状态判定用例（需要 redis-cli 可用）", false, error.message.split("\n")[0]);
  }

  // =========================================================================
  section("6. 登出当前设备：旧 token 401，记录变 logged_out");
  const logout2 = await http("POST", "/mm/Auth/logout", { token: token2 });
  check("POST /mm/Auth/logout 200", logout2.status === 200, { status: logout2.status, body: logout2.body }, apiRepro("POST", "/mm/Auth/logout", { token: true }));
  const afterLogout = await http("GET", "/mm/LoginRecords", { token: token2 });
  check("登出后旧 access token 读接口 401", afterLogout.status === 401, { status: afterLogout.status, body: afterLogout.body });
  await sleep(300); // 记录钩子同步写库，留一点余量
  const r2After = recordById(r2?.id);
  check("DB: R2 的 logout_at 已写入", r2After?.logoutAt != null, r2After?.logoutAt, dbCmd(`SELECT logout_at FROM user_login_records WHERE id = ${r2?.id ?? 0};`));

  // =========================================================================
  section("7. 重新登录后：上一条 logged_out、新一条 current");
  const login3 = await http("POST", "/mm/Auth/login", {
    headers: {
      "X-Forwarded-For": CN_XFF,
      "X-Client-Platform": "mp-weixin",
      "X-Client-Device": "Xiaomi 14",
      "User-Agent": UA_WEIXIN_ANDROID,
    },
    body: { email: EMAIL, password: PASSWORD },
  });
  check("重新登录（国内）200", login3.status === 200 && Boolean(login3.body?.token), { status: login3.status, body: login3.status === 200 ? undefined : login3.body });
  const sid3 = decodeJwt(login3.body?.token)?.sid;
  if (sid3) sids.push(sid3);
  const r3 = latestRecord();
  check("DB: 第三条记录（国内）", r3 !== null && r3.id !== r2?.id, r3 ? { id: r3.id } : dbDetail("无记录"));
  if (r3) {
    check("DB: R3 device='Xiaomi 14 · 微信'", r3.device === "Xiaomi 14 · 微信", r3.device);
    check("DB: R3 is_domestic=1", r3.isDomestic === "1", r3.isDomestic);
  }

  const all3 = await http("GET", "/mm/LoginRecords?scope=all", { token: login3.body?.token });
  const a3 = all3.body ?? {};
  check("重新登录后 all: total=3 / domesticTotal=2 / allTotal=3", a3.total === 3 && a3.domesticTotal === 2 && a3.allTotal === 3, {
    total: a3.total,
    domesticTotal: a3.domesticTotal,
    allTotal: a3.allTotal,
  });
  check("重新登录后 all 排序（R3,R2,R1）", a3.items?.length === 3 && Number(a3.items[0]?.id) === r3?.id && Number(a3.items[1]?.id) === r2?.id && Number(a3.items[2]?.id) === r1?.id, a3.items?.map((item) => item.id));
  check("R3 status=current", a3.items?.[0]?.status === "current", a3.items?.[0]?.status);
  check("R2 status=logged_out（上一设备已登出）", a3.items?.[1]?.status === "logged_out", a3.items?.[1]?.status);
  check("R2 响应里 logoutAt 非空", a3.items?.[1]?.logoutAt != null, a3.items?.[1]?.logoutAt);
  check("R1 status=active（未登出）", a3.items?.[2]?.status === "active", a3.items?.[2]?.status);
  const domestic3 = await http("GET", "/mm/LoginRecords?scope=domestic", { token: login3.body?.token });
  check("domestic 视角 total=2（R3,R1）", domestic3.body?.total === 2 && domestic3.body?.domesticTotal === 2 && domestic3.body?.allTotal === 3, {
    total: domestic3.body?.total,
    domesticTotal: domestic3.body?.domesticTotal,
    allTotal: domestic3.body?.allTotal,
  });

  // =========================================================================
  section("8. 全端登出（logout-all）：所有记录 logged_out，新登录恢复正常（含境外 IPv6 脱敏）");
  const logoutAll = await http("POST", "/mm/Auth/logout-all", { token: login3.body?.token });
  check("POST /mm/Auth/logout-all 200", logoutAll.status === 200, { status: logoutAll.status, body: logoutAll.body });
  const afterLogoutAll = await http("GET", "/mm/LoginRecords", { token: login3.body?.token });
  check("全端登出后旧 token 401", afterLogoutAll.status === 401, afterLogoutAll.status);
  await sleep(1200); // 撤销时间戳按秒判定，跨过 1 秒再登录

  const login4 = await http("POST", "/mm/Auth/login", {
    headers: {
      "X-Forwarded-For": OVERSEAS_V6_XFF,
      "User-Agent": UA_WEIXIN_IPHONE,
    },
    body: { email: EMAIL, password: PASSWORD },
  });
  check("全端登出后重新登录 200", login4.status === 200 && Boolean(login4.body?.token), { status: login4.status, body: login4.status === 200 ? undefined : login4.body });
  const sid4 = decodeJwt(login4.body?.token)?.sid;
  if (sid4) sids.push(sid4);
  const r4 = latestRecord();
  check("DB: 第四条记录（境外 IPv6）", r4 !== null && r4.id !== r3?.id, r4 ? { id: r4.id } : dbDetail("无记录"));
  if (r4) {
    check("DB: R4 ip 全量存库=2001:4860:4860::8888", r4.ip === OVERSEAS_V6_XFF, r4.ip);
    check("DB: R4 is_domestic=0 / location=境外", r4.isDomestic === "0" && r4.location === "境外", { isDomestic: r4.isDomestic, location: r4.location });
    check("DB: R4 platform 由 UA 推断为 mp-weixin", r4.platform === "mp-weixin", r4.platform);
    check("DB: R4 device 由 UA 兜底为非空", typeof r4.device === "string" && r4.device.length > 0, r4.device);
    check("DB: R4 logout_at 为空（新会话）", r4.logoutAt === null, r4.logoutAt);
  }

  const all4 = await http("GET", "/mm/LoginRecords?scope=all", { token: login4.body?.token });
  const a4 = all4.body ?? {};
  check("全端登出后 all: total=4 / domesticTotal=2 / allTotal=4", a4.total === 4 && a4.domesticTotal === 2 && a4.allTotal === 4, {
    total: a4.total,
    domesticTotal: a4.domesticTotal,
    allTotal: a4.allTotal,
  });
  check("全端登出后 all 排序（R4,R3,R2,R1）", a4.items?.length === 4 && Number(a4.items[0]?.id) === r4?.id && Number(a4.items[1]?.id) === r3?.id && Number(a4.items[2]?.id) === r2?.id && Number(a4.items[3]?.id) === r1?.id, a4.items?.map((item) => item.id));
  check("R4 status=current", a4.items?.[0]?.status === "current", a4.items?.[0]?.status);
  check("R4 ipMasked='2001:4860:*'（IPv6 只留前两组）", a4.items?.[0]?.ipMasked === "2001:4860:*", a4.items?.[0]?.ipMasked);
  check("R1/R2/R3 全端登出后均 logged_out", [a4.items?.[1], a4.items?.[2], a4.items?.[3]].every((item) => item?.status === "logged_out"), {
    r3: a4.items?.[1]?.status,
    r2: a4.items?.[2]?.status,
    r1: a4.items?.[3]?.status,
  });

  const domestic4 = await http("GET", "/mm/LoginRecords?scope=domestic", { token: login4.body?.token });
  check("domestic 视角 total=2 且两条都 logged_out", domestic4.body?.total === 2 && domestic4.body?.items?.length === 2 && domestic4.body.items.every((item) => item.status === "logged_out"), {
    total: domestic4.body?.total,
    statuses: domestic4.body?.items?.map((item) => item.status),
  });
  check("DB: 最终 4 条登录记录全部属于测试用户", recordCount() === 4, { count: recordCount() }, dbCmd(`SELECT COUNT(*) FROM user_login_records WHERE user_id = ${uid};`));
} catch (error) {
  failures.push({ label: `脚本异常中断：${error.message.split("\n")[0]}` });
  console.error(`\n  FATAL  ${error.stack ?? error.message}`);
} finally {
  section("清理：删除临时测试用户（FK CASCADE 带走登录记录）+ Redis 标记");
  const cleanupProblems = cleanupTestData();
  for (const problem of cleanupProblems) {
    failures.push({ label: `清理：${problem}` });
    console.log(`  FAIL  清理：${problem}`);
  }
  if (cleanupProblems.length === 0) console.log("  PASS  测试数据已清理干净");

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
