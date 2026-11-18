# DailyCheck API 接口文档（按最新控制器同步）

> 更新时间：2026-11-18  
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
| POST | `/change-email` | 换绑邮箱（新邮箱验证码 + 当前身份校验） |
| POST | `/profile` | 更新个人资料 |
| GET | `/me` | 获取当前用户资料 |
| GET | `/account/status` | 获取账号更新状态 |
| POST | `/account` | 更新账号（用户名） |
| POST | `/` | 登出（使会话失效） |
| POST | `/wechat/bind` | 绑定微信 |
| DELETE | `/wechat/unbind` | 解绑微信 |
| GET | `/bindings` | 获取第三方绑定状态 |

> 个人主页背景图字段说明：`GET /me`（`UserBasicResponse`）返回新增字段 `profileBackgroundKey`；
> `POST /profile`（`UpdateUserProfileRequest`）也接受可选的 `profileBackgroundKey`：
> 传字符串则设置为该背景图 key，传空字符串 `""` 表示清除（恢复默认背景），不传或传 `null` 表示不修改。
> 另外，登录 / 注册 / 刷新令牌 / 微信登录绑定等接口返回的 `AuthResponse` 同样包含 `profileBackgroundKey`。

### 1.3 登录记录

控制器：`LoginRecordsController`（不属于 `/mm/auth` 前缀）  
路由前缀：`/mm/LoginRecords`

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/mm/LoginRecords?page=1&pageSize=20&scope=domestic` | 是 | 分页获取当前登录用户的登录记录（国内 / 全部） |

查询参数：

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `page` | int | `1` | 页码，小于 1 按 1 处理 |
| `pageSize` | int | `20` | 每页数量，取值夹到 `1..50` |
| `scope` | string | `domestic` | `domestic`=仅国内（默认）；`all`=全部（含境外 / 内网）；非法值按 `domestic` |

响应示例（200，`scope=domestic`）：

```json
{
  "scope": "domestic",
  "page": 1,
  "pageSize": 20,
  "total": 3,
  "domesticTotal": 3,
  "allTotal": 5,
  "items": [
    {
      "id": 12,
      "device": "iPhone 13 · 微信",
      "platform": "mp-weixin",
      "loginType": "password",
      "location": "河南 · 郑州",
      "ipMasked": "222.137.*.*",
      "province": "河南",
      "city": "郑州",
      "district": "金水",
      "isp": "联通",
      "isDomestic": true,
      "status": "current",
      "loginAt": "2026-11-18T02:30:00Z",
      "logoutAt": null
    }
  ]
}
```

规则说明：

- **数据来源**：每次**成功登录**写一条 `user_login_records`；`loginType` 取值
  `password`（邮箱/用户名密码登录）/ `email-code`（验证码登录）/ `wechat`（微信注册 / 登录 / 一键登录）/
  `register`（邮箱注册）/ `email-change`（换绑邮箱后重新签发令牌）。`POST /auth/refresh` 只是同设备续期，**不记录**。
- **国内 / 境外**：`isDomestic=1` 表示 IP 命中 GeoCN（MaxMind 判定为中国大陆的网段）。
  国内记录带 `province / city / district / isp`（省市区为简称，如 河南 / 郑州 / 金水），
  `location` 归一化为「省 · 市」（市为空只显省）；境外为「境外」，内网 / 回环为「本地网络」，
  GeoCN 库未加载时为「未知位置」。省 = 编码/10000*10000、市 = 编码/100*100、区 = 编码；
  直辖市省名等于市名时只保留省名。
- **状态三态**：`current` = 该条记录的 `sessionId` 与当前请求令牌的 sid 一致（当前登录）；
  `logged_out` = 该记录已登出（`logoutAt` 非空）或被撤销（设备级撤销标记 / 账号级撤销时间戳）；
  其余为 `active`（仍在线）。登出 / 全部登出 / 注销 / 改密后对应记录变为 `logged_out`。
- **分页与排序**：按 `loginAt` 倒序（同一时间按 id 倒序）；响应同时返回
  `total`（当前 scope 总数）、`domesticTotal`（国内总数）、`allTotal`（全部总数）。
- **IP 脱敏**：`ipMasked` 中 IPv4 只保留前两段（`222.137.*.*`），IPv6 只保留前两组（`240e:476:*`），
  无 IP 时为 `null`；真实 IP 不对外返回。
- **设备信息**：优先取前端请求头 `X-Client-Platform` / `X-Client-Device`（小程序上报机型），
  否则由 User-Agent 解析兜底（如 `iPhone`、`Android 13`、`Chrome · Windows`）。
- **时间**：`loginAt` / `logoutAt` 均为 UTC，JSON 为 ISO 8601（带 `Z`）。
- 未携带有效访问令牌（或令牌已撤销）返回 `401`。
- 只查询当前登录用户自己的记录，不存在越权读取他人记录的入口。

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
| POST | `/profile-background` | 是 | 上传 / 更换个人主页背景（返回 `key`） |
| DELETE | `/profile-background` | 是 | 恢复默认背景（清空 `profileBackgroundKey`） |
| GET | `/users/{userId}/{key}` | 否 | 获取公开头像 / 背景图 |
| POST | `/images` | 是 | 上传业务图片（返回 `url`） |
| GET | `/images/{fileKey}` | 是 | 获取私有图片 |

上传限制：
- 单文件最大 10MB
- 必须是图片文件，支持 JPG / PNG / GIF / WebP / BMP / SVG / ICO / **HEIC / HEIF**
- HEIC/HEIF 会由服务端解码后统一转换为 WebP 存储（聊天图片同样适用）

### 4.1 个人主页背景图

用于小程序 `/pages/profile/index` 头像卡的自定义背景图：上传成功即更新当前用户的
`profile_background_key`，`DELETE` 可恢复默认背景（未设置时前端回退用头像图作背景）。
前端头像卡默认用头像图作背景，设置后显示自定义图，支持「更换背景 / 查看大图 / 恢复默认背景」。

#### 上传 / 更换背景

`POST /mm/files/profile-background`（需认证）

请求：`multipart/form-data`，字段 `file`（必填，原图）与 `thumbnail`（可选，缩略占位图；不传则由服务端从原图自动生成）。

curl 示例：

```bash
curl -X POST "http://localhost:5210/mm/files/profile-background" \
  -H "Authorization: Bearer <access_token>" \
  -F "file=@background.jpg" \
  -F "thumbnail=@background-thumb.jpg"
```

成功响应（200）：

```json
{
  "key": "7c31f3be1578d0ba9cbe6ba7cc5f653eea4b86ae4392ccfa92ffd4de8c77eb03",
  "thumbnailKey": "7c31f3be1578d0ba9cbe6ba7cc5f653eea4b86ae4392ccfa92ffd4de8c77eb03_thumb"
}
```

失败响应：
- `400`：文件为空（`文件不能为空`）或格式不支持；
- `404`：用户不存在。

限制与存储：
- 单文件最大 10MB，支持格式与头像一致：JPG / PNG / GIF / WebP / BMP / SVG / ICO / **HEIC / HEIF**。
- 服务端统一转换为有损 WebP（质量 85），最长边压缩到 **1600px** 以内（只缩不放）。
- 同时预处理缩略占位图 `{key}_thumb.webp`（有损 WebP 质量 70，最长边 ≤128px）；客户端传了 `thumbnail` 就用它，未传则由服务端从原图自动生成。
- 缩略占位图用于前端**渐进加载**：头像卡先渲染小体积缩略图，原图下载完成后淡入，避免整卡等待大图。
- 文件存储于公开用户目录 `api/uploads/public/users/{userId}/`，与头像同目录、内容哈希命名。
- 上传成功自动写入当前用户的 `profile_background_key`，无需再调用 `POST /mm/auth/profile`。

#### 恢复默认背景

`DELETE /mm/files/profile-background`（需认证）

成功响应（200）：

```json
{
  "success": true
}
```

失败响应：
- `404`：用户不存在。

说明：将当前用户 `profile_background_key` 置为 `NULL`，头像卡回退使用头像图作为背景。

#### 读取背景图

复用公开接口 `GET /mm/files/users/{userId}/{key}`（无需认证）：
- 原图：`GET /mm/files/users/{userId}/{key}`，成功返回图片二进制流，响应头 `Cache-Control: public, max-age=86400, immutable`；
- 缩略占位图：`GET /mm/files/users/{userId}/{key}?thumbnail=true`（同样匿名、同样缓存头；`thumbnail=true` 也接受 `1` / `yes`）；缩略图不存在时回退返回原图；
- `key` / `thumbnailKey` 变化即 URL 变化，可安全长期缓存；
- 前端头像卡渐进加载：先请求 `?thumbnail=true` 显示占位图，原图加载完成后再淡入；无自定义背景时回退的头像图同样可用 `?thumbnail=true` 作占位。

---

## 5. 聊天（Chat）

控制器：`ChatController`  
路由前缀：`/mm/chat`

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/conversations` | 创建会话（支持 `direct` 双人 / `group` 多人） |
| GET | `/conversations` | 获取当前用户会话列表（含最后一条消息和未读数） |
| GET | `/conversations/{conversationId}` | 获取会话详情（含成员列表） |
| POST | `/conversations/{conversationId}` | 更新会话信息（也用于置顶 / 免打扰等个人设置） |
| POST | `/conversations/{conversationId}/messages` | 发送消息 |
| POST | `/conversations/{conversationId}/delete` | 删除会话聊天记录（仅自己不可见，伪删除） |
| POST | `/messages/{messageId}/recall` | 撤回消息（自己 5 分钟内；群主/管理员可撤回他人） |
| POST | `/messages/{messageId}/delete` | 删除一条消息（仅自己不可见，伪删除） |
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

### 5.8 撤回消息

`POST /mm/chat/messages/{messageId}/recall`

规则：
- 自己的消息：发送后 **5 分钟**内可撤回；
- 群主：可撤回管理员、普通成员的消息，不能撤回群主（自己）的消息；
- 管理员：仅可撤回普通成员的消息，不能撤回群主或其它管理员；
- 普通成员 / 单聊：不能撤回别人的消息；
- 管理撤回不受 5 分钟限制，提示直接展示在**被撤回消息原来的位置**（不会在底部追加系统消息）：
  - `群主 {操作人昵称} 撤回了 {被撤回消息的成员昵称} 的消息`
  - `管理员 {操作人昵称} 撤回了 {被撤回消息的成员昵称} 的消息`
- 系统消息不支持撤回；
- 无权限返回 `403`；自己的消息超过 5 分钟返回 `400`。

撤回后消息内容清空并标记 `isRecalled=true`；管理撤回时额外返回：
- `recalledByUserId`：执行撤回的用户 ID；
- `recallPrompt`：展示在原消息位置的提示文案（自己撤回时为空，前端回退到「xxx 撤回了一条消息」）。

前端通过 `chat:message-updated`（action=recall）用返回的 message 原地更新该消息，不新增消息。

### 5.9 消息伪删除（仅自己不可见）

`POST /mm/chat/messages/{messageId}/delete`

说明：
- 不物理删除 `chat_messages`，只在 `chat_message_deletions` 写入一条 `(message_id, user_id)` 删除标记。
- 仅当前用户拉取消息、会话预览、未读数时过滤；对方和其它群成员不受影响。
- 同一账号的其它设备会收到 `chat:message-deleted` 事件。
- 支持删除任意成员的消息（包括别人发送的），但只影响自己。

返回示例：
```json
{
  "messageId": 316,
  "conversationId": 11,
  "hidden": true
}
```

### 5.10 删除会话聊天记录（仅自己不可见）

`POST /mm/chat/conversations/{conversationId}/delete`

说明：
- 在 `chat_conversation_members` 上打标记：
  - `is_hidden = 1`：会话从当前用户的收件箱消失；
  - `history_cleared_before_message_id = 当前最新消息 ID`：旧消息对当前用户不可见。
- 对方、群成员的历史记录完全不受影响。
- 收到新消息（包括系统消息）时 `is_hidden` 会自动清掉，会话重新出现；
  `history_cleared_before_message_id` 保持不变，因此清除前的历史仍然看不到。
- 接口会同步写入 `soft_delete_logs` 审计日志。

返回示例：
```json
{
  "conversationId": 11,
  "clearedBeforeMessageId": 316,
  "hidden": true
}
```

### 5.11 用户主页

`GET /mm/Users/{userId}/profile`

说明：
- 返回昵称、账号、头像、注册时间、好友关系、好友备注、单聊会话 ID 等公开信息。
- `profileBackgroundKey` 为对方个人主页背景图 key（`string | null`）；为 `null` 表示未设置自定义背景，前端回退用 `avatarKey` 头像图作为背景。
- `hasPendingSentRequest` / `hasPendingReceivedRequest` 用于主页「添加好友」按钮状态：已发申请显示「申请已发送」，对方已申请显示「接受好友申请」。
- `isBlocked` 表示当前用户是否已拉黑对方；为 `true` 时前端显示「已拉黑」徽标与「解除拉黑」按钮。
- `isBlockedByTarget` 表示对方是否已拉黑当前用户；被拉黑方仍可查看主页，但前端会显示「对方已拉黑你」并隐藏「发消息 / 添加好友」等互动按钮。
- 不会返回邮箱、密码哈希等敏感字段。
- 聊天页右键头像、群聊详情成员头像、好友搜索结果头像的「查看主页」都使用该接口。
- 非好友主页的「添加好友」按钮复用 `POST /mm/friends/requests`（`receiverUserId` 为目标用户）。

返回示例：
```json
{
  "userId": 11,
  "userAccount": "user_2gjfaaa",
  "nickName": "腐竹炒肉拌面",
  "avatarKey": "f056e9a0...",
  "profileBackgroundKey": null,
  "createdAt": "2026-01-19T09:36:17",
  "isSelf": false,
  "isFriend": true,
  "isBlocked": false,
  "isBlockedByTarget": false,
  "friendRemark": null,
  "directConversationId": 7,
  "hasPendingSentRequest": false,
  "hasPendingReceivedRequest": false,
  "status": "active"
}
```

### 5.12 用户拉黑 / 黑名单

用户级拉黑（与后台「冻结账号」的 `user_blacklist_records` 无关），按拉黑方方向存储在 `user_blocks`。

#### 获取黑名单

`GET /mm/friends/blacklist`

- 返回当前用户拉黑的用户列表，按拉黑时间倒序。
- 每项包含 `id`（拉黑记录 ID）、`userId`、`userAccount`、`nickName`、`avatarKey`、`createdAt`。

#### 拉黑用户

`POST /mm/friends/blacklist`

```json
{ "userId": 11 }
```

- 幂等：重复拉黑不会产生重复记录。
- 不能拉黑自己；目标用户不存在时返回 `404`。
- 拉黑后，双方之间待处理的好友申请会自动取消。
- 通过 `chat:friendships-updated` / `chat:friend-requests-updated` 通知双方刷新列表。

#### 解除拉黑

`DELETE /mm/friends/blacklist/{blockedUserId}`

- 幂等：没有拉黑关系时返回 `204`。
- 已取消的好友申请不会自动恢复。

#### 拉黑后的行为约束

若 A 拉黑 B：

- B 无法向 A 发送好友申请（`403`）、无法发起单聊（`403`）、无法在已有单聊中向 A 发送消息（`403`）；
- B 搜索用户时不再出现 A；
- B 仍可查看 A 的主页，但主页会返回 `isBlockedByTarget: true`，前端显示「对方已拉黑你」并隐藏互动按钮；
- B 的好友列表中不再显示 A，但 `user_friendships` 不删除，好友状态保持；
- A 仍可查看 B 的主页、搜索到 B，好友列表也仍显示 B；
- 双方共同所在的群聊、群消息收发与群成员关系完全不受影响。

### 5.13 实时通信（SignalR）

Hub 路径：`/hubs/chat`（JWT 鉴权，客户端通过 `access_token` Query 传递）

客户端推荐策略：
- 使用 `@microsoft/signalr` 自动协商传输，优先 WebSocket，不可用时回落 Long Polling。
- 若 SignalR 建链失败（网络/代理限制等），前端自动降级为 `messages/delta` 轮询模式。

服务端事件：
- `chat:message-updated`：当会话有新消息时推送，携带 `conversationId`、`messageId`、`messageType`、`createdAt`。
- `chat:message-deleted`：当同一账号在别处删除了一条消息时推送，携带 `conversationId`、`messageId`、`deletedAt`（只发给删除者本人）。
- `chat:inbox-updated`：会话列表需要刷新时推送（新消息、已读、删除会话等）。
- `chat:friendships-updated`：好友关系变化时推送（通过/删除好友、拉黑/解除拉黑等），收到后刷新好友与黑名单。
- `chat:friend-requests-updated`：好友申请变化时推送，收到后刷新申请列表。

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

