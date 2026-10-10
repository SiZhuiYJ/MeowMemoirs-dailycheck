# DailyCheck API 接口文档（按最新控制器同步）

> 更新时间：2026-04-07  
> 服务基路径：`/mm`  
> 认证方式：`Authorization: Bearer <access_token>`（标记匿名的接口除外）

---

## 1. 认证与账户（Auth）

控制器：`AuthController`  
路由前缀：`/mm/auth`

### 1.1 匿名接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/register` | 邮箱 + 验证码注册 |
| POST | `/login` | 邮箱密码登录 |
| POST | `/login-account` | 用户名密码登录 |
| POST | `/login-email-code` | 邮箱验证码登录 |
| POST | `/refresh` | 使用 refresh token 刷新登录态 |
| POST | `/email-code` | 发送邮箱验证码 |
| POST | `/validate-account?userAccount=xxx` | 校验用户名是否可用 |
| POST | `/wechat/register` | 微信注册 |
| POST | `/wechat/login` | 微信登录（仅已注册） |
| POST | `/wechat/login-auto` | 微信一键登录（自动注册或登录） |

### 1.2 需认证接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/deactivate` | 注销/停用账户 |
| POST | `/change-password` | 修改密码 |
| POST | `/profile` | 更新个人资料 |
| GET | `/me` | 获取当前用户资料 |
| GET | `/account/status` | 获取账号更新状态 |
| POST | `/account` | 更新账号（用户名） |
| POST | `/` | 登出（使会话失效） |
| POST | `/wechat/bind` | 绑定微信 |
| DELETE | `/wechat/unbind` | 解绑微信 |
| GET | `/bindings` | 获取第三方绑定状态 |

---

## 2. 打卡计划（Plans）

控制器：`PlansController`  
路由前缀：`/mm/plans`

### 2.1 新接口（统一使用）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 获取当前用户所有计划 |
| GET | `/{planId}` | 获取单个计划详情 |
| POST | `/` | 创建计划 |
| PUT | `/{planId}` | 更新计划 |
| DELETE | `/{planId}` | 删除计划（软删除） |

### 2.2 兼容旧接口（仅兼容，不建议继续使用）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/update` | 旧版更新接口 |
| POST | `/delete?planId={id}` | 旧版删除接口 |

---

## 3. 打卡记录（Checkins）

控制器：`CheckinsController`  
路由前缀：`/mm/checkins`

### 3.1 新接口（统一使用）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/` | 当日打卡 |
| POST | `/backfill` | 补打卡 |
| GET | `/plans/{planId}/calendar?year=YYYY&month=MM` | 获取计划月历打卡状态 |
| GET | `/plans/{planId}/details?date=YYYY-MM-DD` | 获取计划某日打卡详情 |

### 3.2 兼容旧接口（仅兼容，不建议继续使用）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/daily` | 旧版当日打卡 |
| POST | `/retro` | 旧版补打卡 |
| GET | `/calendar?planId=1&year=YYYY&month=MM` | 旧版月历查询 |
| GET | `/detail?planId=1&date=YYYY-MM-DD` | 旧版详情查询 |

---

## 4. 文件（Files）

控制器：`FilesController`  
路由前缀：`/mm/files`

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| POST | `/avatar` | 是 | 上传头像（返回 `key`） |
| GET | `/users/{userId}/{key}` | 否 | 获取公开头像 |
| POST | `/images` | 是 | 上传业务图片（返回 `url`） |
| GET | `/images/{fileKey}` | 是 | 获取私有图片 |

上传限制：
- 单文件最大 10MB
- 必须是图片文件

---

## 5. 聊天（Chat）

控制器：`ChatController`  
路由前缀：`/mm/chat`

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/conversations` | 创建会话（支持 `direct` 双人 / `group` 多人） |
| GET | `/conversations` | 获取当前用户会话列表（含最后一条消息和未读数） |
| GET | `/conversations/{conversationId}` | 获取会话详情（含成员列表） |
| POST | `/conversations/{conversationId}` | 更新会话信息 |
| POST | `/conversations/{conversationId}/messages` | 发送消息 |
| GET | `/conversations/{conversationId}/messages?beforeMessageId=&pageSize=` | 分页拉取消息记录（默认20，最大100） |
| GET | `/conversations/{conversationId}/messages/delta?afterMessageId=&pageSize=` | 拉取增量消息（用于推送/轮询） |
| POST | `/conversations/{conversationId}/read` | 更新当前用户会话已读位置并写入回执 |

### 5.1 创建会话

`POST /mm/chat/conversations`

请求体：
```json
{
  "conversationType": "direct",
  "title": "项目讨论群",
  "avatarKey": "public/chat/group-1.webp",
  "memberUserIds": [8, 11]
}
```

约束：
- `conversationType` 仅支持 `direct`、`group`。
- 服务端会自动补入当前登录用户 ID 并去重。
- `direct` 必须恰好 2 人，若两人会话已存在则直接返回已存在会话详情。
- `group` 至少 2 人。
- 所有成员必须是有效用户（未删除且状态正常）。

### 5.2 会话列表

`GET /mm/chat/conversations`

返回字段要点：
- `unreadCount`：当前用户未读消息数（按 `lastReadMessageId` 计算）。
- `lastMessage`：会话最新一条消息摘要。
- 置顶会话优先排序，其次按最新消息倒序。

### 5.3 会话详情

`GET /mm/chat/conversations/{conversationId}`

返回字段要点：
- `conversationType`、`title`、`ownerUserId`、`isActive`。
- `members[]`：成员列表，包含 `memberRole`、`joinedAt`、`lastReadMessageId`。

### 5.4 发送消息

`POST /mm/chat/conversations/{conversationId}/messages`

请求体：
```json
{
  "messageType": "text",
  "content": "今天晚点同步一下进度",
  "extra": null,
  "replyToMessageId": null
}
```

约束：
- `messageType`：`text` / `image` / `file` / `system`。
- 文本消息必须提供非空 `content`。
- `replyToMessageId`（可选）必须属于当前会话。

### 5.5 拉取消息记录

`GET /mm/chat/conversations/{conversationId}/messages?beforeMessageId=123&pageSize=20`

说明：
- 未传 `beforeMessageId` 时返回最新一页。
- 按消息时间正序返回（便于直接渲染时间线）。

### 5.6 拉取消息增量（推送轮询）

`GET /mm/chat/conversations/{conversationId}/messages/delta?afterMessageId=456&pageSize=50`

说明：
- `afterMessageId` 可选，不传时等同于从 0 开始拉取。
- 返回结构包含：
  - `messages[]`：本次增量消息（按 ID 升序）。
  - `lastMessageId`：当前会话最新消息 ID（便于前端对齐游标）。
  - `hasMore`：是否仍有未拉取的增量。
- 建议前端每 3~5 秒轮询一次该接口，实现“信息推送”体验。

### 5.7 标记已读

`POST /mm/chat/conversations/{conversationId}/read`

请求体：
```json
{
  "lastReadMessageId": 456
}
```

说明：
- `lastReadMessageId` 可选，不传时自动标记到当前会话最新消息。
- 会同步写入 `chat_message_receipts` 回执记录（仅对他人消息写入）。

### 5.8 实时通信（SignalR）

Hub 路径：`/hubs/chat`（JWT 鉴权，客户端通过 `access_token` Query 传递）

客户端推荐策略：
- 使用 `@microsoft/signalr` 自动协商传输，优先 WebSocket，不可用时回落 Long Polling。
- 若 SignalR 建链失败（网络/代理限制等），前端自动降级为 `messages/delta` 轮询模式。

服务端事件：
- `chat:message-updated`：当会话有新消息时推送，携带 `conversationId`、`messageId`、`messageType`、`createdAt`。

客户端 Hub 方法：
- `SubscribeConversation(conversationId)`：订阅会话消息推送。
- `UnsubscribeConversation(conversationId)`：取消订阅。

## 6. 本次客户端迁移结论

- `web` 与 `uni-app` 中 `plans/checkins` 已统一迁移到新接口：
  - `POST /mm/plans/update` -> `PUT /mm/plans/{planId}`
  - `POST /mm/plans/delete?planId=...` -> `DELETE /mm/plans/{planId}`
  - `POST /mm/checkins/daily` -> `POST /mm/checkins`
  - `POST /mm/checkins/retro` -> `POST /mm/checkins/backfill`
  - `GET /mm/checkins/calendar?planId=...` -> `GET /mm/checkins/plans/{planId}/calendar`
  - `GET /mm/checkins/detail?planId=...` -> `GET /mm/checkins/plans/{planId}/details`

