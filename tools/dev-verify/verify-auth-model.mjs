// 验证「短令牌做业务 + 长令牌只换令牌 + 多端并存 + 登出即时生效」
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { API, JWT_KEY, REDIS_PASS } from './config.mjs';

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const rcli = (...args) => execFileSync('redis-cli', ['-h', '127.0.0.1', '-a', REDIS_PASS, '--no-auth-warning', ...args]).toString().trim();

function mint(userId, typ, minutes) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({
    sub: String(userId), email: `u${userId}@dev.local`,
    'http://schemas.microsoft.com/ws/2008/06/identity/claims/role': 'user',
    jti: `auth${typ}${now}${Math.random().toString(36).slice(2, 6)}`, typ,
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

const USER = 14;                 // 用未在用的账号，避免影响你正在用的会话
const DEVICE_A_REFRESH = mint(USER, 'refresh', 60 * 24 * 7);
const DEVICE_B_REFRESH = mint(USER, 'refresh', 60 * 24 * 7);
// 模拟两台设备各自的短令牌（真实场景由 /refresh 下发）
let devA = mint(USER, 'access', 30);
let devB = mint(USER, 'access', 30);

console.log('\n=== 1. 长令牌（refresh）不能用于访问业务接口 ===');
let r = await api(DEVICE_A_REFRESH, 'GET', '/mm/Chat/conversations');
check('用 refresh 令牌访问业务接口被拒 401', r.status === 401, { status: r.status, body: r.body });

console.log('\n=== 2. 两台设备同时在线，互不干扰 ===');
r = await api(devA, 'GET', '/mm/Chat/conversations');
check('设备A 访问 200', r.status === 200, r.status);
r = await api(devB, 'GET', '/mm/Chat/conversations');
check('设备B 访问 200（旧实现这里会被顶成 401）', r.status === 200, r.status);

console.log('\n=== 3. 两台设备各自用长令牌刷新，反复进行都不互相作废 ===');
let aTokens = null, bTokens = null;
for (let round = 1; round <= 3; round++) {
  const ra = await api(devA, 'POST', '/mm/Auth/refresh', { refreshToken: DEVICE_A_REFRESH });
  const rb = await api(devB, 'POST', '/mm/Auth/refresh', { refreshToken: DEVICE_B_REFRESH });
  check(`第${round}轮 设备A/B 刷新都成功`, ra.status === 200 && rb.status === 200, { a: ra.status, b: rb.status });
  if (ra.status === 200) { devA = ra.body.token; aTokens = ra.body; }
  if (rb.status === 200) { devB = rb.body.token; bTokens = rb.body; }
  check(`第${round}轮 两端都还能访问`, (await api(devA, 'GET', '/mm/Chat/conversations')).status === 200
    && (await api(devB, 'GET', '/mm/Chat/conversations')).status === 200);
}

console.log('\n=== 4. 同一个长令牌被并发/重复使用不再被判失效 ===');
const concurrent = await Promise.all([
  api(DEVICE_A_REFRESH, 'POST', '/mm/Auth/refresh', { refreshToken: DEVICE_A_REFRESH }),
  api(DEVICE_A_REFRESH, 'POST', '/mm/Auth/refresh', { refreshToken: DEVICE_A_REFRESH }),
]);
check('同一 refresh 令牌并发两次都成功（旧实现第二次会 401 → 强制登出）',
  concurrent.every((x) => x.status === 200), concurrent.map((x) => x.status));

console.log('\n=== 5. 服务端下发的短令牌带上了 iat（撤销判定的前提）===');
const payload = decode(aTokens.token);
check('access 令牌包含 iat', typeof payload.iat === 'number', { iat: payload.iat, typ: payload.typ, exp: payload.exp });
check('access 令牌 typ=access', payload.typ === 'access');
const rp = decode(aTokens.refreshToken);
check('refresh 令牌 typ=refresh 且有效期≈7天', rp.typ === 'refresh' && (rp.exp - rp.iat) > 6 * 24 * 3600, { life: Math.round((rp.exp - rp.iat) / 86400) + '天' });
check('短令牌有效期≈30分钟', Math.round((payload.exp - payload.iat) / 60) === 30, Math.round((payload.exp - payload.iat) / 60) + '分钟');

console.log('\n=== 6. 全端登出即时生效（/mm/Auth/logout-all）===');
r = await api(devA, 'POST', '/mm/Auth/logout-all');
check('全端登出接口 200', r.status === 200, r.body);
const afterA = await api(devA, 'GET', '/mm/Chat/conversations');
const afterB = await api(devB, 'GET', '/mm/Chat/conversations');
check('设备A 的令牌立即失效 401', afterA.status === 401, afterA.status);
check('设备B 的令牌也立即失效 401（登出对所有端生效）', afterB.status === 401, afterB.status);
const refreshAfterLogout = await api(DEVICE_A_REFRESH, 'POST', '/mm/Auth/refresh', { refreshToken: DEVICE_A_REFRESH });
check('登出后长令牌也不能再换取新令牌 401', refreshAfterLogout.status === 401, refreshAfterLogout.status);

console.log('\n=== 7. 登出后重新签发的令牌可正常使用（撤销时间戳不会误伤新令牌）===');
await new Promise((res) => setTimeout(res, 1100));
const fresh = mint(USER, 'access', 30);
r = await api(fresh, 'GET', '/mm/Chat/conversations');
check('登出后新签发的短令牌 200', r.status === 200, r.status);

console.log('\n=== 8. 清理：移除测试账号的撤销标记，避免影响你后续登录 ===');
rcli('del', `auth_revoked_before:${USER}`);
check('撤销标记已清理', rcli('exists', `auth_revoked_before:${USER}`) === '0');

console.log(`\n===== 结果：${failures === 0 ? '全部通过' : `${failures} 项失败`} =====\n`);
process.exit(failures === 0 ? 0 : 1);
