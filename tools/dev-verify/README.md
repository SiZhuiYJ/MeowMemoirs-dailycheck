# tools/dev-verify — 开发期端到端验证

对**本地开发环境**跑真实接口/SignalR 的验证套件。这些脚本会伪造开发令牌（用 `api/appsettings.Development.json` 里的 `Jwt:Key`）并写入 Redis，
所以**只能对本地开发实例运行，绝不能指向生产环境**。

## 为什么不含密钥

脚本目录里没有任何凭据：`config.mjs` 统一从 **`api/appsettings.Development.json`**（已被 `.gitignore` 忽略）读取
`Jwt:Key`、Redis 密码、Kestrel 端口，因此本目录可以安全地随仓库提交。

需要换端口/环境时用环境变量覆盖，无需改代码：

```bash
DEV_VERIFY_API=http://127.0.0.1:5210 \
DEV_VERIFY_JWT_KEY=... DEV_VERIFY_REDIS_PASS=... \
node tools/dev-verify/run-all.mjs
```

## 前置条件

1. 后端与依赖已启动：`sv status devnotebookapi mysqld redis`（或自行 `dotnet run`）
2. 已按 README 配置好 `api/appsettings.Development.json`
3. 数据库里存在测试会话：脚本默认使用群聊 **conversation 10**（成员 user 8 / 11 / 14），
   其中 `verify-pin-mute` 用 user 11（普通成员）、user 8（群主）验证权限边界

> `verify-device-layout*.mjs` 两个套件是**纯前端逻辑验证**，不需要后端 / MySQL / Redis，
> 也不读写数据库，可以随时单独跑。

## 运行

```bash
node tools/dev-verify/run-all.mjs          # 全部套件 + 汇总
node tools/dev-verify/e2e-chat.mjs         # 单个套件

# 不需要后端，随手可跑（改完响应式相关代码建议跑一下）
node tools/dev-verify/verify-device-layout.mjs
node tools/dev-verify/verify-device-layout-dom.mjs
```

## 套件说明

| 套件 | 需要后端 | 覆盖内容 |
| --- | --- | --- |
| `e2e-chat.mjs` | 是 | 会话列表、**发消息不再吞掉对端未读**、标记已读与回执、批量已读状态接口、未读不含 system 消息、列表排序 |
| `e2e-signalr.mjs` | 是 | 客户端**不订阅任何会话**也能收到消息、事件携带完整 message、批量回执事件、重连后仍自动入组 |
| `verify-auth-model.mjs` | 是 | 长令牌不能访问业务接口、多端并存、并发/重复刷新不再判失效、令牌 `typ`/`iat`/有效期、全端登出 `logout-all` 即时生效 |
| `verify-device-logout.mjs` | 是 | **只登出当前设备**（另一台不受影响）、刷新沿用同一 `sid`、账号级撤销仍可全端下线 |
| `verify-pin-mute.mjs` | 是 | 普通成员可切换置顶/免打扰（曾因误判为「改群资料」被 403）、改群名仍被拒、群主可改 |
| `verify-device-layout.mjs` | 否 | 布局判定纯函数（规则：**横屏一律桌面，竖屏按宽度**）：横屏手机 852x393/667x375 必须走桌面、竖屏平板 820x1180 走桌面、窄竖屏窗口 700x1200 走手机、边界值、软键盘；**全矩阵**校验 JS 判定与 SCSS mixin 一致、`@mixin desktop` 是 `@mixin phone` 的严格取反、`@mixin phone` 带 `orientation: portrait`、断点常量无漂移；**防回归**校验 `@mixin compact` 同时覆盖「窄」与「矮」、聊天/计划页侧栏用 `clamp` 占比而非写死 px、全局小屏层收窄了 EP 弹层内边距 |
| `verify-device-layout-dom.mjs` | 否 | 「判定结果 → `<html>` 属性 / CSS 变量」契约：横屏手机写 `data-layout=desktop`（同时 `data-phone=true`、`data-short=true`）、旋转成竖屏后布局翻转为 mobile、软键盘只改 `--app-h` 不改布局判定、`installDeviceLayout` 幂等 |

> 这两个套件用最小 DOM 桩在 Node 里直接跑（`registerHooks` 补 `@/` 别名解析），
> 断言的正是 CSS 侧依赖的那些属性与变量 —— 契约断了会有近百项断言直接变红。

## 副作用

- 会向 conversation 10 发送若干条测试消息（内容形如 `e2e-peer-<时间戳>`）。
- `verify-pin-mute` 会切换并复原 user 11 的置顶/免打扰。
- 鉴权类套件使用 user 14，并在结束时清理 `revoked_sid:*` / `auth_revoked_before:*`，不影响你正在用的登录状态。
