/**
 * 聊天文件上传的「重复上传」验证（后端接口 + 真库，不需要浏览器）。
 *
 *   node tools/dev-verify/verify-chat-upload-dedup.mjs
 *
 * 钉死的是一个曾经真炸过的 500：
 *
 *   chat_file_records 上的 `ux_chat_file_records_file_key` 是**全局唯一索引**，
 *   而图片的 fileKey 原来就是内容哈希本身，于是
 *     · 同一张图在同一会话发第二次            → 撞唯一索引 → 500「上传失败」；
 *     · 同一张图发到另一个会话（同一用户）    → 一样撞索引 → 500。
 *   原来那句「文件已存在」的预检比的是 `file.FileName`（用户原始文件名），
 *   入库的却是哈希，两者永远不相等 —— 那段检查从未生效。
 *
 * 现在 fileKey 带会话作用域（`{会话}_{内容哈希}`），同一份字节在同一会话里重复上传是**幂等**的：
 * 复用同一条记录、同一个 fileKey、同一份物理文件，第二条消息照样能显示。
 *
 * ## 前置条件
 * 1. 后端在跑（默认 http://127.0.0.1:5210，DEV_VERIFY_API 可覆盖）；
 * 2. 开发令牌可伪造（读 api/appsettings.Development.json）且 Redis 可写；
 * 3. 能读数据库（mariadb 客户端，用于核对记录没有重复行）。
 *
 * ## 副作用
 * 会往 user 8 所属的两个会话（默认 10 与 7）各上传一份测试文件，并在 chat_file_records
 * 里留下对应记录；不改动已有记录。
 */
import { createHmac } from "node:crypto";
import { API, JWT_KEY, dbq, rcli } from "./config.mjs";
import { makePng } from "./_fixtures.mjs";

const USER_ID = Number(process.env.DEV_VERIFY_USER_ID ?? 8);
const CONVERSATION_A = Number(process.env.DEV_VERIFY_CONVERSATION ?? 10);
const CONVERSATION_B = Number(process.env.DEV_VERIFY_CONVERSATION_B ?? 7);

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  <- ${detail}`}`);
};

const skip = (reason) => {
  console.log(`SKIP  聊天文件重复上传验证：${reason}`);
  console.log("\n跳过（前置条件不满足）");
  process.exit(0);
};

// ── 前置条件 ──────────────────────────────────────────────────────────────
try {
  const res = await fetch(`${API}/mm/Auth/login`, { method: "POST", signal: AbortSignal.timeout(3000) });
  if (res.status >= 500) skip(`后端返回 ${res.status}（${API}）`);
} catch {
  skip(`后端不可达（${API}），先启动 api`);
}

function mintToken() {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: String(USER_ID),
    email: `user${USER_ID}@dev.local`,
    "http://schemas.microsoft.com/ws/2008/identity/claims/role": "user",
    jti: `dedup${now}${USER_ID}`,
    typ: "access",
    iss: "MeowMemoirs",
    aud: "MeowMemoirs",
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const token = `${signingInput}.${createHmac("sha256", JWT_KEY).update(signingInput).digest("base64url")}`;
  rcli("set", `access_token:${USER_ID}`, token);
  return token;
}

let token;
try {
  token = mintToken();
} catch (error) {
  skip(`无法伪造开发令牌 / 写 Redis：${String(error.message ?? error).split("\n")[0]}`);
}

/** 确认两个会话都真的存在且该用户是成员，否则接口会 403，断言就没意义了。 */
try {
  const memberships = dbq(
    `SELECT conversation_id FROM chat_conversation_members WHERE user_id=${USER_ID} AND left_at IS NULL`,
  )
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (!memberships.includes(CONVERSATION_A) || !memberships.includes(CONVERSATION_B)) {
    skip(`user ${USER_ID} 不是会话 ${CONVERSATION_A}/${CONVERSATION_B} 的成员（可用 DEV_VERIFY_CONVERSATION 覆盖）`);
  }
} catch (error) {
  skip(`无法查询数据库：${String(error.message ?? error).split("\n")[0]}`);
}

// ── 上传工具 ──────────────────────────────────────────────────────────────
async function upload(conversationId, bytes, fileName, mimeType) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), fileName);

  const res = await fetch(`${API}/mm/files/chat/${conversationId}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const text = await res.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    /* 非 JSON 响应（例如 500 的 HTML） */
  }
  return { status: res.status, payload, text };
}

async function download(fileKey) {
  const res = await fetch(`${API}/mm/files/chat/${fileKey}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const buffer = res.status === 200 ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
  return { status: res.status, bytes: buffer.length, buffer };
}

const seed = Date.now() % 997;
const png = makePng(96, 64, seed);
const imageName = `dedup-${seed}.png`;
const textBytes = Buffer.from(`dedup probe ${seed}\n同一份文本上传两次\n`, "utf8");
const textName = `dedup-${seed}.txt`;

// ══════════════════════════════════════════════════════════════════════════
// 场景一：同一张图在同一会话里传两次（曾经 500）
// ══════════════════════════════════════════════════════════════════════════
console.log(`\n— 会话 ${CONVERSATION_A}：同一张图上传两次 —`);
const first = await upload(CONVERSATION_A, png, imageName, "image/png");
check("第一次上传成功", first.status === 200, `HTTP ${first.status} ${first.text.slice(0, 120)}`);

const second = await upload(CONVERSATION_A, png, imageName, "image/png");
check("第二次上传同一张图也成功（不再 500）", second.status === 200, `HTTP ${second.status} ${second.text.slice(0, 160)}`);

const firstKey = first.payload?.fileKey ?? "";
const secondKey = second.payload?.fileKey ?? "";
check("两次返回同一个 fileKey（幂等复用）", Boolean(firstKey) && firstKey === secondKey, `${firstKey} / ${secondKey}`);
check(
  "fileKey 带会话作用域（{会话}_{哈希}）",
  firstKey.startsWith(`${CONVERSATION_A}_`),
  firstKey,
);

if (firstKey) {
  const fetched = await download(firstKey);
  check("重复上传后文件仍可下载", fetched.status === 200 && fetched.bytes > 0, `HTTP ${fetched.status}`);

  try {
    const rows = Number(
      dbq(`SELECT COUNT(*) FROM chat_file_records WHERE file_key='${firstKey.replace(/'/g, "''")}'`),
    );
    check("库里只有一条记录（没有插出重复行）", rows === 1, `实测 ${rows} 行`);
  } catch (error) {
    check("库里只有一条记录（没有插出重复行）", false, String(error.message ?? error).slice(0, 120));
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 场景二：同一张图发到另一个会话（曾经同样 500）
// ══════════════════════════════════════════════════════════════════════════
console.log(`\n— 会话 ${CONVERSATION_B}：同一张图再传一次 —`);
const crossConversation = await upload(CONVERSATION_B, png, imageName, "image/png");
check(
  "同一份字节上传到另一个会话成功",
  crossConversation.status === 200,
  `HTTP ${crossConversation.status} ${crossConversation.text.slice(0, 160)}`,
);

const crossKey = crossConversation.payload?.fileKey ?? "";
check("跨会话得到不同的 fileKey（不共用同一份物理文件）", Boolean(crossKey) && crossKey !== firstKey, `${crossKey} vs ${firstKey}`);

if (crossKey) {
  const fetched = await download(crossKey);
  check("跨会话那份文件也能下载", fetched.status === 200 && fetched.bytes > 0, `HTTP ${fetched.status}`);
}

// ══════════════════════════════════════════════════════════════════════════
// 场景三：非图片（.txt）重复上传 —— fileKey 带原始后缀，内容按字节原样存
// ══════════════════════════════════════════════════════════════════════════
console.log(`\n— 会话 ${CONVERSATION_A}：同一份 .txt 上传两次 —`);
const textFirst = await upload(CONVERSATION_A, textBytes, textName, "text/plain");
check("第一次上传 .txt 成功", textFirst.status === 200, `HTTP ${textFirst.status} ${textFirst.text.slice(0, 120)}`);

const textSecond = await upload(CONVERSATION_A, textBytes, textName, "text/plain");
check("第二次上传同一份 .txt 也成功", textSecond.status === 200, `HTTP ${textSecond.status} ${textSecond.text.slice(0, 160)}`);

const textKey = textFirst.payload?.fileKey ?? "";
check("两次返回同一个 fileKey", Boolean(textKey) && textKey === (textSecond.payload?.fileKey ?? ""), textKey);
check("非图片的 fileKey 保留原始后缀（Content-Type 才对得上）", textKey.endsWith(".txt"), textKey);

if (textKey) {
  const fetched = await download(textKey);
  check(
    "下载回来的字节与上传完全一致",
    fetched.status === 200 && fetched.buffer.equals(textBytes),
    `HTTP ${fetched.status}，${fetched.bytes} 字节`,
  );
}

console.log(failures === 0 ? "\n全部通过" : `\n失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
