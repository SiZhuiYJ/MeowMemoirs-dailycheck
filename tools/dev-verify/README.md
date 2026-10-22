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
> `verify-chat-layout.mjs` 用**真实 chromium** 量布局，需要 dev server（默认 5173）、
> 可伪造的开发令牌与 chromium 本体；缺任何一个都只打 `SKIP` 并返回 0。

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
| `verify-device-layout.mjs` | 否 | 布局判定纯函数（规则 A：**横屏一律桌面，竖屏按宽度**；规则 B：**设备档位三档（宽度为主 + 宽扁小屏破格双栏）**）：横屏手机 852x393/667x375 必须走桌面、竖屏平板 820x1180 走桌面、窄竖屏窗口 700x1200 走手机、边界值、软键盘；三档档位归属（<=600 手机 / 600~1200 平板 / >1200 大屏电脑）、**宽扁小屏破格双栏**（宽<=600 但宽/高>=1.5，如手机横屏 480x320/568x320）与 600/601/1200/1201 四个边界；**全矩阵**校验 JS 判定与 SCSS mixin 一致（`phone`/`desktop` 两档 + `device-phone/tablet/desktop` 三档互斥完备）、`@mixin desktop` 是 `@mixin phone` 的严格取反、`@mixin phone` 带 `orientation: portrait`、断点常量无漂移；**防回归**校验聊天页三档（手机单栏 / 平板双栏 / 移动端 24px 控件 + 6px 间距）、`@mixin compact` 同时覆盖「窄」与「矮」、聊天/计划页侧栏用 `clamp` 占比而非写死 px、全局小屏层收窄了 EP 弹层内边距 |
| `verify-chat-layout.mjs` | 是（dev server + chromium） | 用 CDP 驱动 headless chromium 打开真实 `/chat`，逐视口量 `getBoundingClientRect`：大屏电脑端（>1200）双栏 + 32px 控件/12px 间距、平板端（600~1200）**双栏** + 24px/6px、手机端（<=600）**单栏** + 24px/6px；含 600/601/1200/1201 四个边界、横屏手机 852x393 走平板档、**宽扁小屏 480x320/568x320/600x400 走双栏而 480x400 仍单栏**、无横向溢出、手机档有「会话列表」返回按钮。缺 chromium / dev server / 令牌时 `SKIP` |
| `verify-chat-image-upload.mjs` | 是（dev server + chromium） | **图片上传全流程**：用 CDP 把一张 169×120 的图塞进真实的 `<input type=file>`，再用 `Fetch` 域把上传请求按住在发送前，观察「上传中」那一帧（灰色蒙层 + `radial-gradient` 径向挖空，挖空半径 = 上传进度 0/50/100%），放行后断言**待发气泡立刻变成正常图片消息**（不会卡在「准备中」）、图片按自身宽度显示而不是塞进 300px 盒子、气泡右边缘贴着右侧头像且间距正好是 `--chat-gap`、文档/音频卡片仍能撑开；再切 360×800 / 320×568 两档窄屏验证媒体跟着收缩、无横向溢出。缺 chromium / dev server / 令牌时 `SKIP` |
| `verify-chat-upload-dedup.mjs` | 是 | **同一份文件重复上传不能失败**（曾经 500）：`chat_file_records` 上 `ux_chat_file_records_file_key` 是全局唯一索引，而图片 fileKey 原来就是内容哈希本身 → 同一张图在同会话发第二次、或同一张图发到另一个会话，都会撞索引 → 500。现校验：同会话重复上传两次都 200 且**同一个 fileKey**（幂等复用）、库里只有一条记录、文件仍可下载；同一份字节上传到另一个会话成功且 fileKey 不同（各存各的目录）；非图片（.txt）重复上传同样幂等、fileKey 保留原始后缀、下载字节与上传完全一致 |
| `verify-device-layout-dom.mjs` | 否 | 「判定结果 → `<html>` 属性 / CSS 变量」契约：横屏手机写 `data-layout=desktop` 且 `data-device=tablet`（同时 `data-phone=true`、`data-short=true`）、旋转成竖屏后布局翻转为 mobile 且档位翻转为 phone、竖屏平板 768x1024 是 tablet 档（不是单栏手机）、软键盘只改 `--app-h` 不改布局判定、`installDeviceLayout` 幂等 |

> `_fixtures.mjs` 是共用模块（测试用 PNG 生成等），文件名 `_` 开头，`run-all` 会跳过、不当套件跑。
>
> 这两个套件用最小 DOM 桩在 Node 里直接跑（`registerHooks` 补 `@/` 别名解析），
> 断言的正是 CSS 侧依赖的那些属性与变量 —— 契约断了会有近百项断言直接变红。

## 副作用

- 会向 conversation 10 发送若干条测试消息（内容形如 `e2e-peer-<时间戳>`）。
- `verify-pin-mute` 会切换并复原 user 11 的置顶/免打扰。
- 鉴权类套件使用 user 14，并在结束时清理 `revoked_sid:*` / `auth_revoked_before:*`，不影响你正在用的登录状态。
- `verify-chat-layout` 会给 user 8 写一份 `access_token:8`（与 e2e 套件相同，只写 Redis 不改库），
  并在结束时杀掉自己启动的 chromium（临时 profile 目录一并删除）。
- `verify-chat-image-upload` 同样使用 user 8，并会往 conversation 10 真发一张 169×120 的测试图
  （文件名 `verify-upload-169x120-<随机>.png`）。图片内容每次随机 —— 服务端按内容哈希去重，
  同一份字节重复上传会 500；随机噪点同时保证每次跑都是新文件。
- 需要观察上传动画的套件把 `Fetch` 域当「网络暂停键」用（Chrome 的
  `Network.emulateNetworkConditions` **不限上行**，靠它压根采不到上传中的那一帧）。
- `verify-chat-upload-dedup` 会往 user 8 的两个会话（默认 10 与 7）各传一份测试文件
  （一张 PNG + 一个 .txt），并在 `chat_file_records` 里留下新记录；不动已有记录。
