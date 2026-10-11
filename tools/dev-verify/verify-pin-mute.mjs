// 验证「置顶/免打扰」在普通成员身份下可用，同时不放开群资料修改权限
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { API, JWT_KEY, REDIS_PASS, dbq } from './config.mjs';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function mint(userId) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: String(userId), email: `u${userId}@dev.local`,
    'http://schemas.microsoft.com/ws/2008/06/identity/claims/role': 'user',
    jti: `pm${now}${userId}`, typ: 'access', iss: 'MeowMemoirs', aud: 'MeowMemoirs',
    iat: now, exp: now + 7200,
  })}`;
  return `${input}.${createHmac('sha256', JWT_KEY).update(input).digest('base64url')}`;
}
const tokens = {};
function login(id) {
  if (!tokens[id]) {
    const t = mint(id);
    execFileSync('redis-cli', ['-h', '127.0.0.1', '-a', REDIS_PASS, '--no-auth-warning', 'set', `access_token:${id}`, t], { stdio: 'ignore' });
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
  let parsed; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}
const db = dbq;

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ''}`);
  if (!ok) failures += 1;
};

const CONV = 10;       // 群聊「妙妙屋」，群主=8
const MEMBER = 11;     // 普通成员
const OWNER = 8;

console.log('\n=== 1. 普通成员切换「置顶」（前端原样提交整个会话对象）===');
// 完全复刻前端 useConversations.updateConversation 的载荷
let res = await api(MEMBER, 'POST', `/mm/Chat/conversations/${CONV}`, {
  title: '妙妙屋', isActive: true, isPinned: true, isMuted: false,
});
check('提交完整对象（含未改动的 title/isActive）不再 403', res.status === 200, { status: res.status, message: res.body?.message });
check('置顶已写入数据库', db(`select is_pinned from chat_conversation_members where conversation_id=${CONV} and user_id=${MEMBER}`) === '1');

console.log('\n=== 2. 普通成员切换「消息免打扰」===');
res = await api(MEMBER, 'POST', `/mm/Chat/conversations/${CONV}`, {
  title: '妙妙屋', isActive: true, isPinned: true, isMuted: true,
});
check('免打扰不再 403', res.status === 200, res.status);
check('免打扰已写入数据库', db(`select is_muted from chat_conversation_members where conversation_id=${CONV} and user_id=${MEMBER}`) === '1');

console.log('\n=== 3. 权限没有被放开：普通成员改群标题仍应被拒 ===');
res = await api(MEMBER, 'POST', `/mm/Chat/conversations/${CONV}`, { title: '被改掉的群名', isActive: true, isPinned: true, isMuted: true });
check('改标题仍返回 403', res.status === 403, { status: res.status, message: res.body?.message });
check('提示已中文化', typeof res.body?.message === 'string' && /群主|管理员/.test(res.body.message), res.body?.message);
check('群标题未被改动', db(`select title from chat_conversations where id=${CONV}`) === '妙妙屋');

console.log('\n=== 4. 群主改群标题仍可成功 ===');
res = await api(OWNER, 'POST', `/mm/Chat/conversations/${CONV}`, { title: '妙妙屋2', isActive: true });
check('群主改标题 200', res.status === 200, res.status);
check('标题已更新', db(`select title from chat_conversations where id=${CONV}`) === '妙妙屋2');
res = await api(OWNER, 'POST', `/mm/Chat/conversations/${CONV}`, { title: '妙妙屋', isActive: true });
check('标题已还原为「妙妙屋」', db(`select title from chat_conversations where id=${CONV}`) === '妙妙屋', res.status);

console.log('\n=== 5. 清理测试痕迹（恢复置顶/免打扰为未设置）===');
res = await api(MEMBER, 'POST', `/mm/Chat/conversations/${CONV}`, { title: '妙妙屋', isActive: true, isPinned: false, isMuted: false });
check('恢复 200', res.status === 200, res.status);
check('is_pinned=0 且 is_muted=0', db(`select concat(is_pinned,'/',is_muted) from chat_conversation_members where conversation_id=${CONV} and user_id=${MEMBER}`) === '0/0');

console.log(`\n===== 结果：${failures === 0 ? '全部通过' : `${failures} 项失败`} =====\n`);
process.exit(failures === 0 ? 0 : 1);
