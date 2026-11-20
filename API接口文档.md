# DailyCheck API 接口文档（按最新控制器同步）

> 更新时间：2026-11-20  
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

> 上次头像字段说明：`GET /me`（`UserBasicResponse`）返回 `previousAvatarKey`，登录 / 注册 / 刷新令牌 /
> 微信登录绑定等接口返回的 `AuthResponse` 同样包含该字段；`POST /profile` 传 `avatarKey` 时，
> 服务端会在更新前把旧头像记入 `previous_avatar_key`。客户端的「使用上次头像」入口**始终显示**，
> `previousAvatarKey` 为 `null` 时点击会提示「更换一次头像后可用」（切换接口见 §4.2）。

> 角色字段说明：`GET /me`（`UserBasicResponse`）返回 `role` 字段（`"user"` 普通用户 / `"admin"` 管理员，
> 取数据库 `users.role`，缺省 `"user"`）；登录 / 注册 / 邮箱验证码登录 / 刷新令牌 / 微信注册 / 微信登录 /
> 微信一键登录 / 换绑邮箱 / 更新个人资料 / 改账号名等返回 `AuthResponse` 的接口**同样包含 `role`**。
> 前端据此决定是否显示管理员入口；管理接口的权限判定以数据库中的 `users.role` 为准
> （JWT 里的 role claim 只是签名时的快照），详见 §9。

### 1.3 登录设备列表（最后活跃时间）

控制器：`LoginRecordsController`（不属于 `/mm/auth` 前缀）  
路由前缀：`/mm/LoginRecords`

> **数据模型（v3，两张表）**：
> - `user_login_devices`：登录设备表，一台设备一行，`(user_id, device_key)` 唯一；
>   记录设备展示名 / 平台 / 首次登录时间 / 最后一次登录时间 / **最后活跃时间 `last_active_at`** / 最后一次登录记录ID；
> - `user_login_records`：登录记录表，每次**成功登录**一行，`device_id` 指向目标登录设备。
>
> 页面只展示「该账号**每台设备 + 该设备最后一次登录记录 + 最后活跃时间**」，一台设备一行，
> **只标记当前设备**，其它设备不再显示在线 / 已退出状态。
> 历史数据迁移：旧记录按 `(user_id, platform, device)` 归并为 `device_key = legacy:<md5>` 的设备并回填
> `device_id`；`last_active_at` 回填为原 `last_login_at`，不丢数据。

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/mm/LoginRecords?page=1&pageSize=20&scope=domestic` | 是 | 分页获取当前用户的登录设备列表（每台设备最后一次登录记录 + 最后活跃时间） |
| POST | `/mm/LoginRecords/active` | 是 | 上报当前设备活跃（打开小程序 / 网页时调用），返回 `lastActiveAt` |

查询参数：

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `page` | int | `1` | 页码，小于 1 按 1 处理 |
| `pageSize` | int | `20` | 每页数量，取值夹到 `1..50` |
| `scope` | string | `domestic` | `domestic`=最后一次登录为国内的设备（默认）；`all`=全部设备（含境外 / 内网）；非法值按 `domestic` |

GET 响应示例（200，`scope=all`，计数均为**设备数**）：

```json
{
  "scope": "all",
  "page": 1,
  "pageSize": 20,
  "total": 3,
  "domesticTotal": 2,
  "allTotal": 3,
  "items": [
    {
      "deviceId": 5,
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
      "lastActiveAt": "2026-11-19T07:30:00Z",
      "isCurrent": true,
      "loginAt": "2026-11-18T02:30:00Z"
    }
  ]
}
```

`POST /mm/LoginRecords/active`（需认证，无请求体）响应示例（200）：

```json
{
  "lastActiveAt": "2026-11-19T07:30:00Z"
}
```

规则说明：

- **设备识别（`X-Device-Id`）**：客户端生成并持久化一个设备 ID，放在请求头 `X-Device-Id`
  （只接受 `[A-Za-z0-9._:-]`，长度 8..64；web 用 `localStorage`、uni-app 用本地存储）。
  没有该头的旧客户端由后端用 UA 指纹兜底：`"ua:" + SHA256(platform + "|" + deviceDisplay)` 取前 32 位 hex。
  清缓存 / 换浏览器 = 新设备，这是预期行为。
- **最后活跃时间（`lastActiveAt`）**：活跃 = 打开小程序 / 网页的时间。客户端启动 / 回到前台时调
  `POST /mm/LoginRecords/active` 上报（建议客户端节流，同一进程 60s 内最多一次）；登录本身也算活跃，
  登录成功时同步刷新。新设备第一次上报但还没登录过时，会创建一条**没有登录记录**的设备
  （GET 结果里 `location` 等登录字段为 `null`，`loginAt` 兜底为该设备创建时间）。
- **当前设备（`isCurrent`）**：优先用请求头 `X-Device-Id` 匹配设备 `device_key`；没有该头时兜底用该设备
  最后一条登录记录的 `session_id` 与当前令牌 sid 比对。只有 `isCurrent=true` 的设备前端才显示「当前设备」，
  其它设备不显示任何状态（不返回在线 / 已退出）。
- **同设备复用 / 新设备创建**：同一 `(user_id, device_key)` 再次登录时复用设备
  （`first_login_at` 不变、`last_login_at` / `last_active_at` 更新、设备展示信息刷新），只新增一条登录记录；
  新设备先创建设备行再写记录。`POST /auth/refresh` 只是同设备续期，**不新增设备 / 记录**。
- **国内 / 境外**：按每台设备**最后一次登录记录**的 `isDomestic` 判定（`isDomestic=1` 表示 IP 命中
  GeoCN，即 MaxMind 判定为中国大陆的网段）。国内项带 `province / city / district / isp`
  （省市区为简称，如 河南 / 郑州 / 金水），`location` 归一化为「省 · 市」（市为空只显省）；
  境外为「境外」，内网 / 回环为「本地网络」，GeoCN 库未加载时为「未知位置」。
  省 = 编码/10000*10000、市 = 编码/100*100、区 = 编码；直辖市省名等于市名时只保留省名。
- **分页与排序**：按设备最后活跃时间 `lastActiveAt` 倒序（同一时间按 deviceId 倒序，当前设备通常最前）；
  响应同时返回 `total`（当前 scope 设备数）、`domesticTotal`（最后登录为国内的设备数）、
  `allTotal`（全部设备数）。
- **IP 脱敏**：`ipMasked` 中 IPv4 只保留前两段（`222.137.*.*`），IPv6 只保留前两组（`240e:476:*`），
  无 IP 时为 `null`；真实 IP 不对外返回。
- **设备展示名**：优先取前端请求头 `X-Client-Platform` / `X-Client-Device`（小程序上报机型），
  否则由 User-Agent 解析兜底（如 `iPhone`、`Android 13`、`Chrome · Windows`）。
- **时间**：`lastActiveAt` / `loginAt` 均为 UTC，JSON 为 ISO 8601（带 `Z`）。
- `POST /mm/LoginRecords/active` 上报失败不影响客户端打开应用（服务端内部吞异常只打日志）。
- 未携带有效访问令牌（或令牌已撤销）返回 `401`；只查询当前登录用户自己的设备，不存在越权读取他人设备的入口。

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
| POST | `/avatar` | 是 | 上传头像（返回 `key` 与 `previousKey`） |
| POST | `/avatar/use-previous` | 是 | 切回上次头像（当前 / 上次头像互换，返回 `key` 与 `previousKey`） |
| POST | `/profile-background` | 是 | 上传 / 更换个人主页背景（返回 `key`） |
| DELETE | `/profile-background` | 是 | 恢复默认背景（清空 `profileBackgroundKey`） |
| GET | `/users/{userId}/{key}` | 否 | 获取公开头像 / 背景图 |
| POST | `/images` | 是 | 上传业务图片（返回 `url`） |
| GET | `/images/{fileKey}` | 是 | 获取私有图片 |

上传限制：
- 单文件最大 10MB；**个人主页背景图单独放宽到 20MB**（保留原像素后原始 JPEG/WebP 可能更大）
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
- `400`：文件为空（`文件不能为空`）、格式不支持、超过 20MB，或尺寸过大（最长边 > 8192px，返回 `背景图尺寸过大（最长边不能超过 8192px）`）；
- `404`：用户不存在。

限制与存储：
- 客户端按 1:1 裁剪成正方形后上传；服务端**不缩放像素**，保留裁剪后的原始分辨率。
- 单文件最大 **20MB**，支持格式与头像一致：JPG / PNG / GIF / WebP / BMP / SVG / ICO / **HEIC / HEIF**。
- 已是 WebP 的输入**原样存储**（零重编码，像素 / 画质无损）；其它格式解码后转有损 WebP（质量 85），保留原始分辨率。
- 最长边安全上限 **8192px**，超出返回 `400`「背景图尺寸过大（最长边不能超过 8192px）」。
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

### 4.2 头像与「使用上次头像」

#### 上传头像

`POST /mm/files/avatar`（需认证）

请求：`multipart/form-data`，字段 `file`。

成功响应（200）：

```json
{
  "key": "7c31f3be1578d0ba9cbe6ba7cc5f653eea4b86ae4392ccfa92ffd4de8c77eb03",
  "previousKey": "f056e9a0c3d61b7e2a9f45d8c0b7e6a13d5c8f9b2e7a4d6c0b3e8f1a5d9c7b2e"
}
```

说明：
- 服务端在把 `avatar_key` 更新为新值前，会先把原来的 `avatar_key` 记录到 `previous_avatar_key`；
- `previousKey` 为本次更新前的旧头像 key，**首次上传头像时为 `null`**；
- `POST /mm/auth/profile` 传 `avatarKey` 时同样维护 `previous_avatar_key`（新值写入前记录旧头像）。

#### 使用上次头像（当前 / 上次头像互换）

`POST /mm/files/avatar/use-previous`（需认证，无请求体）

- 把当前头像与上次头像**互换**，无需重新上传图片；连续调用可来回切换；
- 只互换 `avatar_key` / `previous_avatar_key` 两个字段，头像文件本身不删除、不改名。

成功响应（200）：

```json
{
  "key": "f056e9a0c3d61b7e2a9f45d8c0b7e6a13d5c8f9b2e7a4d6c0b3e8f1a5d9c7b2e",
  "previousKey": "7c31f3be1578d0ba9cbe6ba7cc5f653eea4b86ae4392ccfa92ffd4de8c77eb03"
}
```

失败响应：
- `400`：没有可用的上次头像（`previous_avatar_key` 为 `NULL`，例如从未换过头像或已被切回消耗）；
- `404`：用户不存在。

#### 头像读取

不变：`GET /mm/files/users/{userId}/{key}`（匿名，`Cache-Control: public, max-age=86400, immutable`）；
`?thumbnail=true` 返回 96px 缩略图（不存在时回退原图）。

#### 客户端行为

- 小程序「个人信息」页点头像 → 操作表新增「使用上次头像」（入口始终显示；暂无上次头像时点击给出提示），
  有上次头像时弹出对话框展示，确认后调用 `POST /mm/files/avatar/use-previous`；
- Web「设置 → 头像修改」页同样有「使用上次头像」按钮与 `el-dialog` 确认弹窗（无上次头像时按钮禁用并带说明）。

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

---

## 7. 更新日志（Changelog）

控制器：`ChangelogController`  
路由前缀：`/mm/Changelog`

> **数据来源与方案（Markdown 文件 + 进程内解析，不落数据库、无迁移）**：
> 更新日志正文保存在 API 源码内的 Markdown 文件 `api/Resources/changelog/CHANGELOG.md`
> （Keep a Changelog 风格，随 git 版本化、随发布打包——`api.csproj` 的 `Resources/**`
> 会把它拷进输出目录），服务端把文件解析成结构化 JSON 返回。
> 解析结果由单例服务缓存在进程内，按文件「最后修改时间 + 长度」判断是否需要重新解析：
> 改完 Markdown 文件后下一次请求即生效（生产环境随发布生效），无需重启服务，
> 也无数据库表 / 迁移 / 种子数据。
>
> **为什么用 Markdown 文件而不是数据库表**：更新日志是**随代码发布的内容**，和版本号、
> 功能改动一起走 git 评审与回滚；没有后台录入需求，写成文件比「建表 + 管理接口 + 迁移」
> 更简单，也方便开发在一个文件里维护所有版本。
>
> 解析异常不阻断接口：文件缺失 / 解析为空 / 读取失败时返回空列表（200），前端页面照常打开。

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/mm/Changelog?limit=20` | 否（匿名公开） | 获取更新日志版本列表（按日期倒序，含最新版本号 / 日期） |

查询参数：

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `limit` | int | `20` | 最多返回的版本条目数，服务端夹到 `1..50`（小于 1 按 1，大于 50 按 50）；不影响返回的 `total` |

GET 响应示例（200，`GET /mm/Changelog?limit=2`；`total=4` 表示共解析出 4 个版本，`items` 只返回前 2 个）：

```json
{
  "latestVersion": "1.2.0",
  "latestDate": "2026-11-19",
  "total": 4,
  "items": [
    {
      "version": "1.2.0",
      "date": "2026-11-19",
      "sections": [
        {
          "title": "新增",
          "items": [
            "设置页新增「更新日志」：小程序与 Web 均可查看本页内容",
            "登录记录页展示每台设备的「最后活跃时间」"
          ]
        },
        {
          "title": "优化",
          "items": ["登录记录按设备归并展示，并标记当前设备"]
        }
      ]
    },
    {
      "version": "1.1.0",
      "date": "2026-11-15",
      "sections": [
        {
          "title": "新增",
          "items": ["小程序全面接入单色主题"]
        }
      ]
    }
  ]
}
```

Markdown 源文件格式（`api/Resources/changelog/CHANGELOG.md`，Keep a Changelog 风格）：

```markdown
# 更新日志

<!-- 维护说明放注释里，解析器会忽略 -->

## [1.2.0] - 2026-11-19

### 新增

- 设置页新增「更新日志」页面

### 修复

- 登录记录最后活跃时间展示异常
```

规则说明：

- **版本标题**：`## [1.2.0] - 2026-11-19`；方括号版本号必填，` - ` 后的日期可省略——
  省略时该条目 `date` 为 `null`（排序时排到最后）。
- **分组标题**：`### 新增 / ### 优化 / ### 修复`，标题文本原样作为 `sections[].title`，可自行扩展
  （如 `### 安全`）；条目没有 `###` 分组时服务端兜底归入「变更」分组；版本下没有任何条目时
  `sections` 为 `[]`（空数组）。
- **条目**：以 `- ` 开头（也接受 `*` / `+`），一条一行；返回的是去掉列表标记后的纯文本，
  **服务端不做 Markdown 渲染**（行内 `**加粗**` 等标记会原样返回），客户端按纯文本展示。
- **忽略内容**：`<!-- -->` 注释块、`#` 大标题等其它 Markdown 标题（版本 `##` / 分组 `###` 除外）
  会被忽略；空行与缩进不影响解析。
- **排序**：`items` 按 `date` 倒序，日期相同按版本号倒序（`1.2.0 > 1.1.9`）；新版本建议写在文件最上面，
  但返回顺序始终由服务端重新排序。
- **latest**：`latestVersion` / `latestDate` 取排序后的第一条；没有任何数据时均为 `null`
  （第一条没有日期时 `latestDate` 为 `null`）。
- **total 与 limit**：`total` 是解析出的**全部版本数**，不受 `limit` 影响；`items` 最多返回 `limit` 个版本。
- **匿名公开**：无需 `Authorization` 请求头；路由大小写不敏感（`/mm/Changelog` 与 `/mm/changelog` 等价，
  OpenAPI 中写作 `/changelog`，其 servers 已含 `/mm` 前缀）。
- **缺失降级**：数据文件缺失 / 解析为空 / 读取失败时仍返回 `200`，`items: []`、`total: 0`、
  `latestVersion` / `latestDate` 均为 `null`，不返回 5xx，不阻断前端。
- **缓存失效**：解析结果按「文件最后修改时间 + 文件长度」缓存在进程内（单例服务）；修改 Markdown
  文件后下一次请求自动重新解析生效，生产环境随发布的新文件生效（无需重启）。
- 数据文件路径可用配置 `Changelog:FilePath` 覆盖（相对路径基于 ContentRoot）；
  读取异常时返回上一次成功解析的缓存内容（可能为空）。


---

## 8. 课表（Schedule）

控制器：`ScheduleController`  
路由前缀：`/mm/Schedule`  
认证方式：`Authorization: Bearer <access_token>`（全部接口需要登录）

> 数据来源：原「MeowMemoirs 课表项目」的 Schedule / Course / CourseTime 三层模型，
> 已迁移进当前后端。建表脚本：`sql/2026-11-19_schedule_schema.sql`
> （表：`schedules` / `courses` / `course_times`，全部伪删除）。

### 8.1 接口列表

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/mm/Schedule` | 当前用户的课表列表（概要，含课程数量） |
| GET | `/mm/Schedule/{id}` | 课表详情（课表信息 + 课程列表 + 每门课的上课时间段） |
| POST | `/mm/Schedule` | 新建 / 更新课表（`id=0` 新建；同时保存作息时间表） |
| POST | `/mm/Schedule/Import/Preview` | **导入预检**（只解析不写库，返回预览：课程/提示/冲突，供用户确认） |
| POST | `/mm/Schedule/Import` | **从 Excel 导入课表**（multipart 上传，解析后新建一张课表，返回课表详情） |
| DELETE | `/mm/Schedule/{id}` | 删除课表（伪删除，连带课程与时间段） |
| GET | `/mm/Schedule/{id}/Course/{courseId}` | 课程详情（含全部时间段） |
| POST | `/mm/Schedule/{id}/Course` | 新建 / 更新课程（`id=0` 新建；`times` 整体替换，未出现的旧时间段自动伪删除） |
| DELETE | `/mm/Schedule/{id}/Course/{courseId}` | 删除课程（伪删除，连带时间段） |

### 8.1.1 导入课表（两步：`Import/Preview` → `Import`）

`Content-Type: multipart/form-data`，支持 `.xlsx` / `.xls`（≤10MB）。

| 表单字段 | 必填 | 说明 |
|---|---|---|
| `file` | 是 | 课表 Excel 文件 |
| `scheduleName` | 否 | 课表名称；不传时取文件内标题，再退回文件名（≤100 字） |
| `startTime` | 否 | 开课日期 `yyyy-MM-dd`；不传时按文件里的「20xx-20xx 学年第 x 学期」推算，再退回本周一 |
| `weekCount` | 否 | 学期周数；不传时取文件内最大周次，且至少 20（上限 100） |

**第一步：预检 `POST /mm/Schedule/Import/Preview`**

同样 multipart，字段只需 `file`（可选 `scheduleName` / `startTime` / `weekCount` 覆盖默认值）。
**不写数据库**，返回 `ScheduleImportPreviewDto`：

| 字段 | 说明 |
|---|---|
| `scheduleName` | 默认课表名称（文件内标题 → 文件名） |
| `semesterLabel` | 从文件识别的学期（可能为 null） |
| `startTime` | 开课日期 `yyyy-MM-dd` |
| `weekCount` / `sectionCount` | 学期周数 / 节次数 |
| `timetable` | 作息时间（默认 12 节标准时间，超出节次按 45 分钟顺延） |
| `courseCount` / `timeCount` | 课程数 / 时间段数 |
| `courses` | 课程 + 时间段（结构与 `ScheduleDetail.courses` 相同，ID 均为 0） |
| `warnings` | 需要用户确认的提示（缺教师/缺地点/周次缺失/默认日期/默认作息等） |
| `conflicts` | 预检出的时间冲突（同一天 + 节次重叠 + 周次有交集） |

**第二步：正式导入 `POST /mm/Schedule/Import`**

同上 multipart，另可带用户确认后的 `scheduleName`（留空则用默认名称）。
响应 `200` 为 `ScheduleDetail`（新建的课表 + 课程 + 时间段）。

解析能力（`api/Infrastructure/TimetableExcelParser.cs`，与前端 demo 规则一致）：
- 自动识别通用横排课表（节次列 `1-2节`）和教务系统竖排课表（大节列 + 中文小节列 `一…十二`）；
- 展开合并单元格，支持一格多门课、单元格内多行换行；
- 从 `课程/课程号/(x-y节)周次/校区 地点/教师/…` 里提取课程、教室、教师、周次；
- 相邻的同门课自动合并成一段；
- 缺省信息补齐：作息时间默认 12 节标准时间（超出按 45 分钟顺延）、周次默认全学期。

错误码：`400` 文件类型/大小/解析失败（body 为 `{ message }`）；`401` 未登录。

### 8.2 数据结构

```ts
interface ScheduleSummary {
  id: number;
  scheduleName: string;
  startTime: string;    // "yyyy-MM-dd"，学期第一周周一
  weekCount: number;    // 1-100
  timetable: string[];  // 每节课时间，如 ["08:00-08:45", ...]，长度 = 节次数
  remark: string | null;
  courseCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ScheduleDetail extends ScheduleSummary {
  courses: Course[];
}

interface Course {
  id: number;
  scheduleId: number;
  courseName: string;
  color: string;        // #RRGGBB
  remark: string | null;
  times: CourseTime[];
}

interface CourseTime {
  id: number;
  courseId: number;
  location: string;
  teacher: string;
  weekList: number[];   // 周次，如 [1,2,3]
  sectionList: number[];// 节次，如 [1,2]（1 表示第 1 节）
  dayOfWeek: number;    // 1-7（周一到周日）
  remark: string | null;
}
```

请求体：

```jsonc
// POST /mm/Schedule
{ "id": 0, "scheduleName": "2026 春季学期", "startTime": "2026-09-01",
  "weekCount": 20, "timetable": ["08:00-08:45", "08:55-09:40"], "remark": "" }

// POST /mm/Schedule/{id}/Course
{ "id": 0, "courseName": "高等数学", "color": "#9b4f93", "remark": "",
  "times": [
    { "id": 0, "location": "A101", "teacher": "张老师", "dayOfWeek": 1,
      "weekList": [1,2,3,4], "sectionList": [1,2], "remark": "" }
  ] }
```

### 8.3 约定

- **周次计算**：`当前周 = clamp(floor((今天 - startTime)/7天) + 1, 1, weekCount)`。
- **节次**：`sectionList` 对应 `timetable` 的下标（1-based）；多节连上（如 `[1,2]`）前端网格跨行合并。
- **一门课多段**：`times` 中每项是一段（不同星期 / 周次 / 地点 / 教师）。
- **删除**均为伪删除，查询自动过滤；课表 / 课程 / 时间段数据归属当前登录用户，越权返回 404。
- 前端：Web 使用 `web/src/features/schedule/`，小程序使用 `uni-app/src/features/Curriculum/useSchedule.ts`。

---

## 9. 意见反馈（Feedback）

控制器：`FeedbackController`  
路由前缀：`/mm/Feedback`  
认证方式：`Authorization: Bearer <access_token>`（全部接口需要登录）

> 数据来源：单表 `feedbacks`，一条反馈一行；管理员回复**写回同一条记录**
> （`reply_content` / `replied_by_user_id` / `replied_at`），重复回复视为覆盖、不保留历史回复版本。
> 建表脚本：`sql/2026-11-20_feedback.sql`（幂等，可重复执行）。
> 删除为伪删除（`is_deleted`，当前接口没有删除入口，仅预留字段）；`user_id` 外键
> `ON DELETE CASCADE`，`replied_by_user_id` 外键 `ON DELETE SET NULL`。
> 时间字段一律按 UTC 存取，展示时由客户端转本地时区。

### 9.1 接口列表

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/mm/Feedback` | 登录用户（普通用户 / 管理员均可调用） | 提交一条反馈 |
| GET | `/mm/Feedback/mine?page=1&pageSize=20` | 登录用户（只看自己的） | 分页获取「我的反馈」 |
| GET | `/mm/Feedback?page=1&pageSize=20&status=all&keyword=&app=all` | **仅管理员** | 分页查看全部反馈（状态 / 来源筛选 + 关键词搜索） |
| POST | `/mm/Feedback/{id}/reply` | **仅管理员** | 回复指定反馈（重复回复 = 覆盖） |

### 9.2 提交反馈

`POST /mm/Feedback`（需认证）

请求体字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `content` | string | 是 | 反馈内容，trim 后必须非空且 ≤2000 字符 |
| `contact` | string \| null | 否 | 联系方式（邮箱 / 手机号 / QQ 等）；trim 后空串按不填处理（存 `NULL`），≤128 字符 |
| `app` | string | 否 | 来源端：只有 `"mp"` 记为小程序（大小写不敏感），其余（含缺省 / 非法值）一律按网页 `"web"` 处理 |

请求示例：

```json
{
  "content": "希望打卡日历支持导出",
  "contact": "me@example.com",
  "app": "web"
}
```

响应示例（200，`FeedbackItemDto`，新反馈 `status=pending`）：

```json
{
  "id": 12,
  "content": "希望打卡日历支持导出",
  "contact": "me@example.com",
  "app": "web",
  "status": "pending",
  "replyContent": null,
  "repliedAt": null,
  "createdAt": "2026-11-20T09:20:00Z"
}
```

`FeedbackItemDto` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | number(int64) | 反馈 ID |
| `content` | string | 反馈内容（trim 后） |
| `contact` | string \| null | 联系方式（未填写为 `null`） |
| `app` | string | 来源端：`web` 网页 / `mp` 小程序 |
| `status` | string | 处理状态：`pending` 待回复 / `replied` 已回复 |
| `replyContent` | string \| null | 管理员回复内容（未回复为 `null`） |
| `repliedAt` | string \| null | 回复时间（UTC，ISO 8601 带 `Z`；未回复为 `null`） |
| `createdAt` | string | 提交时间（UTC，ISO 8601 带 `Z`） |

### 9.3 我的反馈

`GET /mm/Feedback/mine?page=1&pageSize=20`（需认证）

只返回**当前登录用户自己**且 `is_deleted=0` 的反馈，按 `createdAt` 倒序（同一时间按 `id` 倒序）。

查询参数：

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `page` | int | `1` | 页码，小于 1 按 1 处理 |
| `pageSize` | int | `20` | 每页数量，取值夹到 `1..50` |

响应示例（200，`MyFeedbackListResponse`）：

```json
{
  "page": 1,
  "pageSize": 20,
  "total": 2,
  "items": [
    {
      "id": 12,
      "content": "希望打卡日历支持导出",
      "contact": "me@example.com",
      "app": "web",
      "status": "replied",
      "replyContent": "已加入需求池，感谢反馈",
      "repliedAt": "2026-11-20T09:30:00Z",
      "createdAt": "2026-11-20T09:20:00Z"
    },
    {
      "id": 11,
      "content": "小程序夜间模式字体有点小",
      "contact": null,
      "app": "mp",
      "status": "pending",
      "replyContent": null,
      "repliedAt": null,
      "createdAt": "2026-11-20T08:05:00Z"
    }
  ]
}
```

### 9.4 管理员查看全部反馈

`GET /mm/Feedback?page=1&pageSize=20&status=all&keyword=&app=all`（**仅管理员**）

权限说明：管理接口（本节 + §9.5）**每次请求都查库**确认 `users.role = "admin"` 且用户未被删除；
非管理员（含用户不存在 / 已删除）返回 `403 { "message": "仅管理员可查看全部反馈" }`。
服务端不只看 JWT 里的 role claim：claim 在令牌有效期内是快照，管理员被降权后旧令牌仍带 admin，
而反馈列表会带出所有用户的邮箱 / 账号，属敏感数据，必须每次以数据库为准。

查询参数：

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `page` | int | `1` | 页码，小于 1 按 1 处理 |
| `pageSize` | int | `20` | 每页数量，取值夹到 `1..50` |
| `status` | string | `all` | `pending` 待回复 / `replied` 已回复 / `all` 全部；缺省或非法按 `all`（大小写不敏感） |
| `keyword` | string | 空 | 关键词，trim 后**最多取前 100 字符**（超出截断）；同时匹配反馈内容、联系方式与提交用户（邮箱 / 账号 / 昵称），即 `LIKE %kw%` |
| `app` | string | `all` | `web` 网页 / `mp` 小程序 / `all` 全部；缺省或非法按 `all`（大小写不敏感） |

响应示例（200，`AdminFeedbackListResponse`）：

```json
{
  "page": 1,
  "pageSize": 20,
  "total": 2,
  "pendingTotal": 1,
  "repliedTotal": 1,
  "status": "all",
  "keyword": null,
  "app": "all",
  "items": [
    {
      "id": 12,
      "content": "希望打卡日历支持导出",
      "contact": "me@example.com",
      "app": "web",
      "status": "replied",
      "replyContent": "已加入需求池，感谢反馈",
      "repliedAt": "2026-11-20T09:30:00Z",
      "createdAt": "2026-11-20T09:20:00Z",
      "userId": 3,
      "userAccount": "miao",
      "nickName": "喵喵",
      "email": "me@example.com"
    }
  ]
}
```

响应字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `page` / `pageSize` | int | 当前页码 / 每页数量 |
| `total` | int | 当前筛选条件命中的反馈数 |
| `pendingTotal` / `repliedTotal` | int | **全部**未删除反馈的待回复 / 已回复总数，不受 `keyword` / `app` / `status` 筛选影响（供前端 tab 徽标） |
| `status` | string | 生效的状态筛选：`pending` / `replied` / `all` |
| `keyword` | string \| null | 生效的关键词（trim 后）；无关键词为 `null` |
| `app` | string | 生效的来源端筛选：`web` / `mp` / `all` |
| `items` | array | 当前页反馈，按 `createdAt` 倒序、同一时间按 `id` 倒序；每项为 `AdminFeedbackItemDto` |

`AdminFeedbackItemDto` = `FeedbackItemDto` + 以下用户身份字段（用户被伪删除后仍展示其历史反馈）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `userId` | number(int64) | 提交用户 ID |
| `userAccount` | string \| null | 提交用户账号 |
| `nickName` | string \| null | 提交用户昵称 |
| `email` | string \| null | 提交用户邮箱 |

### 9.5 管理员回复

`POST /mm/Feedback/{id}/reply`（**仅管理员**）

请求体字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `replyContent` | string | 是 | 回复内容，trim 后必须非空且 ≤2000 字符 |

请求示例：

```json
{ "replyContent": "已加入需求池，感谢反馈" }
```

行为：覆盖 `reply_content`，`status` 置为 `replied`，记录 `replied_by_user_id`（当前管理员）与
`replied_at`（UTC），并刷新 `updated_at`；**重复回复视为覆盖**，只保留最后一条回复。
响应 200 为回复后的 `AdminFeedbackItemDto`（结构与 §9.4 的列表项相同，含提交用户身份）。

### 9.6 错误码

| 状态码 | `message` | 触发条件 |
|---|---|---|
| 400 | `反馈内容不能为空` | `content` 缺失或 trim 后为空（§9.2） |
| 400 | `反馈内容不能超过 2000 个字符` | `content` trim 后超过 2000 字符 |
| 400 | `联系方式不能超过 128 个字符` | `contact` trim 后超过 128 字符 |
| 400 | `回复内容不能为空` | `replyContent` 缺失或 trim 后为空（§9.5） |
| 400 | `回复内容不能超过 2000 个字符` | `replyContent` trim 后超过 2000 字符 |
| 401 | （框架默认） | 未登录 / 令牌无效或已撤销 |
| 403 | `仅管理员可查看全部反馈` | 非管理员调用 §9.4 / §9.5 的管理接口（回复接口的 403 也是这句文案） |
| 404 | `反馈不存在` | §9.5 的 `id` 不存在或 `is_deleted=1` |

> 400 / 403 / 404 的响应体均为 `{ "message": "..." }`（camelCase）。

### 9.7 约定与前端入口

- **JSON 命名**：请求 / 响应均为 camelCase（与全站一致）。
- **时间**：`createdAt` / `repliedAt` 一律为 UTC，JSON 为 ISO 8601（带 `Z`），前端按本地时区展示。
- **分页**：管理员列表与「我的反馈」共用 `page` / `pageSize` 规则（默认 20，夹到 `1..50`）。
- **入口差异**：Web 与小程序设置页对普通用户显示「意见反馈」（提交 + 我的反馈），
  对管理员同一入口显示「查看意见」（全部反馈列表 + 筛选 / 搜索 + 回复，**不渲染提交界面**）；
  是否管理员由认证接口返回的 `role` 判断（见 §1.2），管理接口的最终权限仍由服务端查库校验。
- **建表脚本**：`sql/2026-11-20_feedback.sql`（幂等，可重复执行；缺表时 `/mm/Feedback*` 接口会 500）。
