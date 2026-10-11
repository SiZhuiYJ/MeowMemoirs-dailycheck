// SignalR 实时通道端到端验证：客户端「不订阅任何会话」，只依赖服务端自动入组。
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { API, JWT_KEY, REDIS_PASS, WEB_PACKAGE_JSON } from './config.mjs';

const require = createRequire(WEB_PACKAGE_JSON);
const signalR = require('@microsoft/signalr');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function mint(userId) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: String(userId), email: `u${userId}@dev.local`,
    'http://schemas.microsoft.com/ws/2008/06/identity/claims/role': 'user',
    jti: `sig${now}${userId}`, typ: 'access', iss: 'MeowMemoirs', aud: 'MeowMemoirs',
    iat: now, exp: now + 7200,
  };
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${createHmac('sha256', JWT_KEY).update(input).digest('base64url')}`;
}
const tokens = {};
function login(id) {
  if (!tokens[id]) {
    const t = mint(id);
    execFileSync('redis-cli', ['-h', '127.0.0.1', '-a', REDIS_PASS, '--no-auth-warning',
      'set', `access_token:${id}`, t], { stdio: 'ignore' });
    tokens[id] = t;
  }
  return tokens[id];
}
async function api(userId, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${login(userId)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return { status: res.status, body: text ? JSON.parse(text) : null }; }
  catch { return { status: res.status, body: text }; }
}

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ''}`);
  if (!ok) failures += 1;
};

const CONV = 10, ME = 8, PEER = 11;
const received = { message: [], read: [], inbox: [] };

// 观察者：用户 8。只 start()，绝不调用 SubscribeConversation。
const conn = new signalR.HubConnectionBuilder()
  .withUrl(`${API}/hubs/chat`, {
    accessTokenFactory: () => login(ME),
    transport: signalR.HttpTransportType.WebSockets | signalR.HttpTransportType.LongPolling,
  })
  .configureLogging(signalR.LogLevel.Error)
  .withAutomaticReconnect()
  .build();

conn.on('chat:message-updated', (p) => received.message.push(p));
conn.on('chat:message-read', (p) => received.read.push(p));
conn.on('chat:inbox-updated', (p) => received.inbox.push(p));

const waitFor = async (arr, ms = 6000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (arr.length > 0) return arr[0];
    await new Promise((r) => setTimeout(r, 120));
  }
  return null;
};

console.log('\n=== 1. 连接（不订阅任何会话）===');
await conn.start();
check('SignalR 握手成功（state=' + conn.state + '）', conn.state === 'Connected');
console.log('  （未调用 SubscribeConversation，依赖 ChatHub.OnConnectedAsync 自动入组）');

console.log('\n=== 2. 对端发消息 -> 未订阅客户端应实时收到 ===');
const sent = await api(PEER, 'POST', `/mm/Chat/conversations/${CONV}/messages`,
  { messageType: 'text', content: `signalr-peer-${Date.now()}` });
check('对端 HTTP 发送 200', sent.status === 200, sent.status);

const evt = await waitFor(received.message);
check('收到 chat:message-updated 事件', !!evt, evt && { conversationId: evt.conversationId, action: evt.action });
check('事件带完整 message 载荷（前端可本地插入，无需重拉列表）',
  !!evt?.message && String(evt.message.content) === String(sent.body.content),
  evt?.message && { id: evt.message.id, content: evt.message.content });
check('conversationId 正确', Number(evt?.conversationId) === CONV, evt?.conversationId);

console.log('\n=== 3. 对端标记已读 -> 批量回执事件 ===');
const messages = await api(ME, 'GET', `/mm/Chat/conversations/${CONV}/messages?pageSize=10`);
const lastFromMe = messages.body.filter((m) => Number(m.senderUserId) === ME).pop();
const readRes = await api(PEER, 'POST', `/mm/Chat/conversations/${CONV}/read`,
  { lastReadMessageId: Number(lastFromMe.id) });
check('对端 POST /read 200', readRes.status === 200, readRes.body);

const readEvt = await waitFor(received.read);
check('收到 chat:message-read 事件', !!readEvt, readEvt);
check('回执事件为批量格式（含 messageIds 数组）',
  Array.isArray(readEvt?.messageIds) && readEvt.messageIds.length > 0,
  readEvt && { messageId: readEvt.messageId, messageIds: readEvt.messageIds, readByUserId: readEvt.readByUserId });

console.log('\n=== 4. 收件箱事件 ===');
const inboxEvt = await waitFor(received.inbox, 3000);
check('收到 chat:inbox-updated 事件（列表/未读数更新）', !!inboxEvt, inboxEvt);

console.log('\n=== 5. 断线重连后仍能收到（重连即重新自动入组）===');
await conn.stop();
await conn.start();
received.message.length = 0;
const sent2 = await api(PEER, 'POST', `/mm/Chat/conversations/${CONV}/messages`,
  { messageType: 'text', content: `signalr-reconnect-${Date.now()}` });
check('重连后对端再次发送 200', sent2.status === 200, sent2.status);
const evt2 = await waitFor(received.message);
check('重连后仍收到消息事件（无需重新订阅）', !!evt2,
  evt2 && { content: evt2.message?.content });

await conn.stop();
console.log(`\n===== 结果：${failures === 0 ? '全部通过' : `${failures} 项失败`} =====\n`);
process.exit(failures === 0 ? 0 : 1);
