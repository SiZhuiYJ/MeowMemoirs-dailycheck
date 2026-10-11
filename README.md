# 喵咪记事簿 · MeowMemoirs

一个「每日打卡 + 好友聊天」的全栈应用：制定打卡计划、按日打卡并上传图片、查看打卡日历，同时内置好友关系与实时聊天（SignalR）。

- **后端**：`.NET 10` Web API + Entity Framework Core（Pomelo MySQL）+ Redis + JWT + SignalR
- **前端**：`Vue 3` + `TypeScript` + `Vite` + `Element Plus` + `Pinia`
- **移动端**：`uni-app`（微信小程序）
- **数据库**：`MySQL / MariaDB`，库名 `dailycheck`

---

## 目录结构

```
├── api/                 # .NET 10 后端 API（主项目）
│   ├── Controllers/     # Auth / Plans / Checkins / Files / Chat / Friends
│   ├── Data/            # EF Core 实体与 DbContext
│   ├── Hubs/            # SignalR ChatHub（/hubs/chat）
│   ├── Infrastructure/  # JWT、Redis 校验中间件、邮件、文件、密码哈希
│   ├── Models/          # 请求/响应 DTO
│   ├── Resources/       # 邮件模板
│   └── appsettings.json # 配置模板（占位符，见下方「配置」）
├── web/                 # Vue 3 前端
│   └── src/             # features / components / views / stores / libs
├── uni-app/             # uni-app 微信小程序端
├── sql/                 # 数据库导出与优化脚本
├── openapi.yaml         # OpenAPI 描述
├── API接口文档.md        # 接口文档（按控制器同步）
├── FILE_UPLOAD_FEATURE.md
└── 每日打卡网站企划书.md
```

---

## 环境要求

| 组件 | 版本 |
| --- | --- |
| .NET SDK | 10.0 |
| Node.js | 20+（本项目在 26.x 上验证） |
| MySQL / MariaDB | 8.0+ / 10.4+ |
| Redis | 6+ |

---

## 快速开始

### 1. 数据库

```bash
mysql -u root -e "CREATE DATABASE dailycheck CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root dailycheck < sql/dailycheck_2026-05-19_140753（本地化更新）.sql
```

> `sql/` 下的导出文件来自 MySQL 8。导入 MariaDB 时注意两点：
> 1. 全文替换 `utf8mb4_0900_ai_ci` → `utf8mb4_unicode_ci`（MariaDB 不支持前者）；
> 2. 删除 `SET @@GLOBAL.GTID_PURGED=...` 一行（MariaDB 无此变量）。

### 2. Redis

确保 Redis 已启动，并设置密码（或改为无密码后同步修改配置）。

### 3. 配置

`api/appsettings.json` 是**占位符模板**，所有敏感项均为 `CHANGE_ME_*`：

```jsonc
{
  "ConnectionStrings": { "Default": "server=127.0.0.1;database=dailycheck;charset=utf8;uid=root;pwd=CHANGE_ME_DB_PASSWORD;port=3306" },
  "Jwt":        { "Key": "CHANGE_ME_TO_A_LONG_RANDOM_SECRET_AT_LEAST_32_CHARS" },
  "Wechat":     { "AppId": "CHANGE_ME_WECHAT_APPID", "AppSecret": "CHANGE_ME_WECHAT_APPSECRET" },
  "Smtp":       { "UserAccount": "CHANGE_ME_SMTP_ACCOUNT", "Password": "CHANGE_ME_SMTP_PASSWORD" },
  "Redis":      { "Enabled": true, "Configuration": "127.0.0.1:6379,password=CHANGE_ME_REDIS_PASSWORD,..." }
}
```

本地开发请把真实值写入 **`api/appsettings.Development.json`**（该文件已在 `.gitignore` 中忽略，不会入库），它会在 `Development` 环境下覆盖 `appsettings.json`。

也可以直接用环境变量覆盖，无需改文件：

```bash
export ASPNETCORE_ENVIRONMENT=Development
export ConnectionStrings__Default='server=127.0.0.1;database=dailycheck;charset=utf8;uid=root;pwd=<你的密码>;port=3306'
export Redis__Configuration='127.0.0.1:6379,password=<你的密码>,defaultDatabase=0,abortConnect=false,ssl=false'
```

### 4. 启动后端

```bash
cd api
dotnet restore
dotnet build
ASPNETCORE_ENVIRONMENT=Development dotnet run
```

- API 监听：`http://localhost:5210`（见 `appsettings.json` 的 `Kestrel` 节）
- Swagger：`http://localhost:5210/swagger`
- 路由前缀统一为 `/mm`，例如 `/mm/Auth/login-account`、`/mm/Plans`、`/mm/Checkins`
- SignalR 中心：`/hubs/chat`

### 5. 启动前端

```bash
cd web
npm install
npm run dev
```

默认 `http://localhost:5173`（端口被占用时 Vite 会自动顺延，请把实际端口加入后端 `Cors:Origins`）。

接口地址由 `web/.env.development` 的 `VITE_API_BASE_URL` 决定，默认指向 `http://localhost:5210/`。

---

## 功能概览

| 模块 | 说明 |
| --- | --- |
| 认证 Auth | 邮箱验证码注册、账号/密码登录、邮箱验证码登录、微信登录与绑定、JWT 刷新、改密、注销账户 |
| 打卡计划 Plans | 计划的增删改查、时间段（time slots）配置、启用/停用 |
| 打卡记录 Checkins | 打卡（需 1–3 张图片）、补卡、按计划的日历与详情 |
| 好友 Friends | 好友申请、好友列表、黑名单 |
| 聊天 Chat | 会话/群聊、成员与角色、入群申请、消息收发、已读回执、文件消息、SignalR 实时推送 |
| 文件 Files | 上传、预览、下载（图片转 WebP、SHA256 去重） |

> **鉴权模型（双令牌）**
>
> - **短令牌 access（默认 30 分钟）**：用于所有业务接口；`typ=access`，带 `iat`。
> - **长令牌 refresh（默认 7 天）**：**只能**用于 `POST /mm/Auth/refresh` 换新令牌；用它访问业务接口一律 401。
> - **多端并存**：令牌不再与 Redis 中的单一副本做精确比对，手机 + 电脑可同时在线、各自刷新，互不顶掉。
> - **按设备会话（sid）**：登录时生成 `sid` 并写入令牌，刷新时沿用，因此每台设备是一个独立会话。
> - **登出只影响当前设备**：`POST /mm/Auth/logout` 只把本设备的 `sid` 写入撤销标记（`revoked_sid:{sid}`，TTL 与刷新令牌一致），
>   该设备的 access/refresh 令牌**立即失效**，其它设备不受影响。
> - **全端下线**：`POST /mm/Auth/logout-all` 写入账号级撤销时间戳（`auth_revoked_before:{userId}`），
>   签发时间早于它的令牌全部失效；改密码、注销账户同样走这条路径。
> - `RedisTokenValidationMiddleware` 每次请求用一次 `MGET` 同时校验上面两个维度，并显式要求 `typ=access`。
>
> 客户端埋点：`POST /mm/Telemetry/events`（允许匿名，便于「登录过期」后仍能上报），
> 落盘在 `api/errorLog/client/client-YYYYMMDD.log`（JSONL）；`GET /mm/Telemetry/recent`（需登录）可回读。

---

## 说明

- 本仓库中的 `api/appsettings.json` 已做脱敏处理，**不含任何真实密钥**，请勿把真实密钥写回该文件。
- `api/uploads/`、`api/errorLog/`、`api.Release/`、`api/bin/`、`api/obj/` 及 `node_modules/` 均已忽略。
- `uni-app/` 端的微信小程序 `appid` 为示例值，需替换为你自己的小程序 AppID 后才能构建。
