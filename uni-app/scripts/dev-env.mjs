#!/usr/bin/env node
/**
 * 开发环境接口候选地址生成器
 *
 * 用途：在 `npm run dev:h5` / `npm run dev:mp-weixin` 之前自动执行，
 * 扫描本机所有网卡，把「可能的开发后端地址」写成逗号分隔的候选列表，
 * 写入 `.env.development.local`（已被 .gitignore 的 *.local 忽略，不会入库）。
 *
 * 运行时由 `src/libs/http/apiBase.ts` 并行探测这些候选，选第一个可达的：
 *   · 手机本机访问 → 127.0.0.1 命中
 *   · 同一局域网的其他设备（微信开发者工具在 Windows）→ 对应局域网 IP 命中
 * 因此换 Wi-Fi / 换网段都不需要改代码或配置。
 *
 * 手动覆盖：
 *   API_HOSTS=192.168.0.4,10.0.0.5 npm run dev:mp-weixin
 *   DEV_API_PORT=5211 npm run dev:mp-weixin
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.DEV_API_PORT || '5211';
const ENV_FILE = path.join(ROOT, '.env.development.local');

/** 收集本机所有非回环 IPv4 */
function lanAddresses() {
  const result = [];
  const interfaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(interfaces)) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) {
        result.push({ name, address: item.address });
      }
    }
  }
  return result;
}

/** 追加候选（去重、保持顺序） */
function buildCandidates() {
  const candidates = [];
  const add = (address) => {
    if (!address) return;
    const url = `http://${address}:${PORT}`;
    if (!candidates.includes(url)) candidates.push(url);
  };

  // 1) 局域网网卡（同一 Wi-Fi 下的 Windows 开发者工具会用这些地址访问手机）
  const lan = lanAddresses();
  lan.forEach((item) => add(item.address));

  // 2) 本机回环（手机自己访问，或后端与开发者工具同一台电脑）
  add('127.0.0.1');
  add('localhost');

  // 3) 手动额外覆盖
  (process.env.API_HOSTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach(add);

  return { candidates, lan };
}

const { candidates, lan } = buildCandidates();

const content = [
  '# ⚠️ 本文件由 scripts/dev-env.mjs 自动生成（*.local 已被 .gitignore 忽略，不会入库）',
  '# 小程序没有同源代理，开发环境需要绝对地址；这里写入候选列表，',
  '# 由 src/libs/http/apiBase.ts 在运行时并行探测，选第一个可达的后端。',
  `VITE_API_BASE_URL=${candidates.join(',')}`,
  `VITE_API_PROXY_TARGET=http://127.0.0.1:${PORT}`,
  '',
].join('\n');

fs.writeFileSync(ENV_FILE, content, 'utf8');

console.log('[dev-env] 开发后端候选地址（运行时自动选择可达项）：');
candidates.forEach((url, index) => {
  const nic = lan.find((item) => url.includes(item.address));
  console.log(`  ${index + 1}. ${url}${nic ? `  (${nic.name})` : ''}`);
});
console.log(`[dev-env] 已写入 ${path.relative(ROOT, ENV_FILE)}`);
