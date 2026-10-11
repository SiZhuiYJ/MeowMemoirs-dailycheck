// 聊天模块端到端验证脚本（仅本地开发环境使用）
// 通过本地 Jwt:Key 伪造开发令牌 + 写入 Redis access_token，真实调用后端接口。
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { API, JWT_KEY, REDIS_PASS, dbq } from './config.mjs';


const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function mintToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: String(userId),
    email: `user${userId}@dev.local`,
    'http://schemas.microsoft.com/ws/2008/06/identity/claims/role': 'user',
    jti: `dev${now}${userId}`,
    typ: 'access',
    iss: 'MeowMemoirs',
    aud: 'MeowMemoirs',
    iat: now,
    exp: now + 7200,
  };
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const sig = createHmac('sha256', JWT_KEY).update(signingInput).digest('base64url');
  return `${signingInput}.${sig}`;
}

const tokens = {};
function login(userId) {
  if (!tokens[userId]) {
    const token = mintToken(userId);
    execFileSync('redis-cli', ['-h', '127.0.0.1', '-a', REDIS_PASS, '--no-auth-warning',
      'set', `access_token:${userId}`, token], { stdio: 'ignore' });
    tokens[userId] = token;
  }
  return tokens[userId];
}

async function api(userId, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${login(userId)}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ''}`);
  if (!ok) failures += 1;
}

const CONV = 10;
const SENDER = 11;
const READER = 8;

const convOf = async (userId) => {
  const r = await api(userId, 'GET', '/mm/Chat/conversations');
  return (r.body ?? []).find((c) => Number(c.id) === CONV);
};

const latestMessageId = async (userId) => {
  const r = await api(userId, 'GET', `/mm/Chat/conversations/${CONV}/messages?pageSize=5`);
  return Math.max(...r.body.map((m) => Number(m.id)));
};

console.log('\n=== 1. 会话列表可用性 ===');
const list = await api(READER, 'GET', '/mm/Chat/conversations');
check('GET /mm/Chat/conversations 返回 200', list.status === 200, list.status);
check('会话 10 在列表中', Number((await convOf(READER))?.id) === CONV);

console.log('\n=== 2. 发送消息不应把对端未读顺手标记为已读（核心修复）===');
const before = (await convOf(READER)).unreadCount;
console.log(`  初始未读 = ${before}`);

const sentByPeer = await api(SENDER, 'POST', `/mm/Chat/conversations/${CONV}/messages`,
  { messageType: 'text', content: `e2e-peer-${Date.now()}` });
check('对端发送消息 200', sentByPeer.status === 200, sentByPeer.status);
const peerMsgId = Number(sentByPeer.body.id);

const afterPeer = (await convOf(READER)).unreadCount;
check('收到对端消息后未读 +1', afterPeer === before + 1, { before, afterPeer });

const sentByMe = await api(READER, 'POST', `/mm/Chat/conversations/${CONV}/messages`,
  { messageType: 'text', content: `e2e-self-${Date.now()}` });
check('本人发送消息 200', sentByMe.status === 200, sentByMe.status);

const afterSelf = (await convOf(READER)).unreadCount;
check('本人发送后未读保持（旧实现会归零）', afterSelf === afterPeer,
  { afterPeer, afterSelf, explain: '旧代码在 SendMessage 里推进 LastReadMessageId' });

console.log('\n=== 3. 标记已读 -> 回执落库且可被发送方查到 ===');
const maxId = await latestMessageId(READER);
const markRes = await api(READER, 'POST', `/mm/Chat/conversations/${CONV}/read`,
  { lastReadMessageId: maxId });
check('POST /read 200', markRes.status === 200, markRes.body);

const afterRead = (await convOf(READER)).unreadCount;
check('标记已读后未读归零', afterRead === 0, afterRead);

const peerStatus = await api(SENDER, 'GET', `/mm/Chat/messages/${peerMsgId}/read-status`);
check('发送方能查到回执 readCount=1', peerStatus.status === 200 && peerStatus.body.readCount === 1,
  peerStatus.body);

const selfStatus = await api(READER, 'GET', `/mm/Chat/messages/${Number(sentByMe.body.id)}/read-status`);
check('自己发的消息 totalRecipients 排除了自己（应为 2）',
  selfStatus.status === 200 && selfStatus.body.totalRecipients === 2,
  { totalRecipients: selfStatus.body?.totalRecipients, readCount: selfStatus.body?.readCount });

console.log('\n=== 4. 新增批量已读状态接口（替代每条消息一个请求）===');
const ids = [peerMsgId, Number(sentByMe.body.id)];
const batch = await api(READER, 'GET',
  `/mm/Chat/conversations/${CONV}/read-status?messageIds=${ids.join(',')}`);
check('GET /conversations/{id}/read-status 200', batch.status === 200, batch.status);
check('只包含请求的消息',
  Array.isArray(batch.body) && batch.body.every((x) => ids.includes(Number(x.messageId))),
  batch.body?.map((x) => x.messageId));
check('每条都带 totalRecipients / readCount',
  Array.isArray(batch.body) && batch.body.every((x) =>
    typeof x.totalRecipients === 'number' && typeof x.readCount === 'number'),
  batch.body);

const allOwn = await api(READER, 'GET', `/mm/Chat/conversations/${CONV}/read-status`);
check('不传 messageIds 时返回自己最近的消息状态',
  allOwn.status === 200 && Array.isArray(allOwn.body) && allOwn.body.length > 0,
  allOwn.body?.length);

console.log('\n=== 5. 系统消息不进入未读 ===');
const sysUnread = Number(execFileSync('mariadb', ['-u', 'root', '-h', '127.0.0.1', 'dailycheck', '-N', '-B', '-e',
  `select count(*) from chat_messages m join chat_conversation_members mm on mm.conversation_id=m.conversation_id and mm.user_id=${READER}
   where m.conversation_id=${CONV} and m.sender_user_id<>${READER} and m.message_type='system' and m.id>(coalesce(mm.last_read_message_id,0))`]).toString().trim());
const unreadNow = (await convOf(READER)).unreadCount;
check('未读口径不计入 system 消息', sysUnread === 0, { sysUnread, unreadNow });

console.log('\n=== 6. 会话列表排序（置顶优先 + 最近活跃倒序）===');
const ordered = (await api(READER, 'GET', '/mm/Chat/conversations')).body;
const pinnedFirst = ordered.every((c, i) => i === 0 || !(c.isPinned && !ordered[i - 1].isPinned));
check('置顶会话排在前面', pinnedFirst, ordered.map((c) => ({ id: c.id, pinned: c.isPinned })));
check('刚有消息的会话排第一', Number(ordered[0].id) === CONV,
  ordered.map((c) => ({ id: c.id, last: c.lastMessage?.id })));

console.log(`\n===== 结果：${failures === 0 ? '全部通过' : `${failures} 项失败`} =====\n`);
process.exit(failures === 0 ? 0 : 1);
