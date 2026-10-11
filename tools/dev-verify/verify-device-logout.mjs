// 验证「只登出当前设备」：另一台设备完全不受影响；刷新沿用同一设备会话；全端撤销仍可用
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { API, JWT_KEY, REDIS_PASS } from './config.mjs';

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const rcli = (...a) => execFileSync('redis-cli', ['-h', '127.0.0.1', '-a', REDIS_PASS, '--no-auth-warning', ...a]).toString().trim();

function mint(userId, typ, minutes, sid) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({
    sub: String(userId), email: `u${userId}@dev.local`,
    'http://schemas.microsoft.com/ws/2008/06/identity/claims/role': 'user',
    jti: `d${typ}${now}${Math.random().toString(36).slice(2, 6)}`, typ, sid,
    iss: 'MeowMemoirs', aud: 'MeowMemoirs', iat: now, exp: now + minutes * 60,
  })}`;
  return `${input}.${createHmac('sha256', JWT_KEY).update(input).digest('base64url')}`;
}
async function api(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}
const decode = (t) => JSON.parse(Buffer.from(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());

let failures = 0;
const check = (l, ok, d) => { console.log(`${ok ? '  PASS' : '  FAIL'}  ${l}${d !== undefined ? ` -> ${JSON.stringify(d)}` : ''}`); if (!ok) failures += 1; };

const USER = 14;
const SID_A = 'devA' + Math.random().toString(36).slice(2, 8);
const SID_B = 'devB' + Math.random().toString(36).slice(2, 8);
let devA = mint(USER, 'access', 30, SID_A);
let devB = mint(USER, 'access', 30, SID_B);
const refreshA = mint(USER, 'refresh', 60 * 24 * 7, SID_A);
const refreshB = mint(USER, 'refresh', 60 * 24 * 7, SID_B);

console.log('\n=== 1. 两台设备各自在线（不同 sid）===');
check('设备A 访问 200', (await api(devA, 'GET', '/mm/Chat/conversations')).status === 200);
check('设备B 访问 200', (await api(devB, 'GET', '/mm/Chat/conversations')).status === 200);

console.log('\n=== 2. 设备A 登出：「只登出当前设备」===');
let r = await api(devA, 'POST', '/mm/Auth/logout');
check('登出接口 200', r.status === 200, r.body);
r = await api(devA, 'GET', '/mm/Chat/conversations');
check('设备A 的短令牌立即失效 401', r.status === 401, { status: r.status, body: r.body });
r = await api(refreshA, 'POST', '/mm/Auth/refresh', { refreshToken: refreshA });
check('设备A 的长令牌也不能再换新令牌 401', r.status === 401, r.status);

console.log('\n=== 3. 设备B 完全不受影响（关键诉求）===');
r = await api(devB, 'GET', '/mm/Chat/conversations');
check('设备B 访问仍然 200', r.status === 200, r.status);
const bRefresh = await api(refreshB, 'POST', '/mm/Auth/refresh', { refreshToken: refreshB });
check('设备B 仍能正常刷新 200', bRefresh.status === 200, bRefresh.status);
if (bRefresh.status === 200) {
  devB = bRefresh.body.token;
  check('设备B 刷新后仍可访问', (await api(devB, 'GET', '/mm/Chat/conversations')).status === 200);
  check('刷新后沿用同一设备会话 sid（登出才不会因为刷新而失效）',
    decode(bRefresh.body.token).sid === SID_B, { sid: decode(bRefresh.body.token).sid, expected: SID_B });
}

console.log('\n=== 4. 账号级「全端下线」仍然有效（改密码/注销用）===');
rcli('set', `auth_revoked_before:${USER}`, String(Math.floor(Date.now() / 1000)));
const afterAll = await api(devB, 'GET', '/mm/Chat/conversations');
check('全端撤销后设备B 也 401', afterAll.status === 401, afterAll.status);
check('全端撤销后设备B 的刷新也 401',
  (await api(refreshB, 'POST', '/mm/Auth/refresh', { refreshToken: refreshB })).status === 401);
rcli('del', `auth_revoked_before:${USER}`);
await new Promise((res) => setTimeout(res, 1100));
check('撤销标记清除后，新签发令牌恢复正常',
  (await api(mint(USER, 'access', 30, 'newdev'), 'GET', '/mm/Chat/conversations')).status === 200);

console.log('\n=== 5. 清理测试数据 ===');
rcli('del', `revoked_sid:${SID_A}`, `revoked_sid:${SID_B}`, `auth_revoked_before:${USER}`);
check('设备撤销标记已清理', rcli('exists', `revoked_sid:${SID_A}`) === '0');

console.log(`\n===== 结果：${failures === 0 ? '全部通过' : `${failures} 项失败`} =====\n`);
process.exit(failures === 0 ? 0 : 1);
