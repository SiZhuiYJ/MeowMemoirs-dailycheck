# 聊天文件发送功能 - 使用文档

## 概述

本功能为"喵咪记事簿"聊天系统添加了完整的文件发送能力，支持图片、视频、音频、文档和压缩包等多种文件类型。所有聊天文件按会话ID存储，只有会话成员才能访问。

## 文件存储结构

```
uploads/
└── chat/
    ├── {conversationId_1}/           # 会话1的所有文件
    │   ├── avatars/                  # 会话头像
    │   │   └── avatar_hash_timestamp.webp
    │   ├── hash_timestamp.webp       # 聊天图片(自动转WebP)
    │   ├── hash_timestamp.mp4        # 聊天视频
    │   ├── hash_timestamp.pdf        # 聊天文档
    │   └── hash_timestamp.zip        # 聊天压缩包
    └── {conversationId_2}/           # 会话2的所有文件
        └── ...
```

## 支持的文件类型

### 图片 (自动转换为WebP)
- JPG, JPEG, PNG, GIF, WebP, BMP, SVG, ICO

### 视频 (原样保存)
- MP4, AVI, MOV, WMV, FLV, MKV, WebM, M4V

### 音频 (原样保存)
- MP3, WAV, OGG, M4A, FLAC, AAC, WMA, Opus

### 文档 (原样保存)
- PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, RTF, CSV, MD

### 压缩包 (原样保存)
- ZIP, RAR, 7Z, TAR, GZ, BZ2

**文件大小限制**: 100MB

## API 端点

### 1. 上传聊天文件

```http
POST /mm/files/chat/{conversationId}/upload
Content-Type: multipart/form-data
Authorization: Bearer {token}

Form Data:
- file: [文件对象]

Response 200:
{
  "fileKey": "e9d23e011a..._8de989e0109e498.webp",
  "originalFileName": "photo",
  "fileSize": 0,
  "contentType": "image/webp"
}
```

**说明**:
- 图片文件会自动转换为WebP格式以节省存储空间
- 非图片文件保持原始格式
- 返回的 `fileKey` 包含扩展名

### 2. 获取聊天文件

```http
GET /mm/files/chat/{fileKey}
Authorization: Bearer {token}

Response 200: [文件二进制流]
Content-Type: image/webp (或相应类型)
Content-Disposition: inline; filename="..."
```

**权限**: 必须是文件所属会话的成员

### 3. 上传会话头像

```http
POST /mm/files/chat/{conversationId}/avatar
Content-Type: multipart/form-data
Authorization: Bearer {token}

Form Data:
- file: [头像图片文件]

Response 200:
{
  "key": "avatar_abc123_xyz"
}
```

**说明**:
- 仅支持图片格式
- 自动转换为WebP
- 需要手动更新会话的 `avatarKey` 字段

### 4. 获取会话头像

```http
GET /mm/files/chat/{conversationId}/avatars/{fileKey}
Authorization: Bearer {token}

Response 200: [图片二进制流]
Content-Type: image/webp
```

**权限**: 必须是该会话的成员

## 前端使用示例

### 1. 上传并发送文件消息

```typescript
import { uploadChatFile, getChatFileUrl } from '@/features/chat/api';
import type { SendMessagePayload } from '@/features/chat/types';

// 在组件中
async function handleFileSelect(file: File) {
  const conversationId = currentConversation.value.id;
  
  try {
    // 1. 上传文件
    const response = await uploadChatFile(conversationId, file);
    const fileInfo = response.data;
    
    // 2. 构建消息payload
    const payload: SendMessagePayload = {
      messageType: fileInfo.contentType.startsWith('image/') ? 'image' :
                   fileInfo.contentType.startsWith('video/') ? 'video' :
                   fileInfo.contentType.startsWith('audio/') ? 'audio' : 'file',
      extra: JSON.stringify({
        fileName: fileInfo.originalFileName,
        fileSize: fileInfo.fileSize,
        fileUrl: getChatFileUrl(fileInfo.fileKey),
        fileKey: fileInfo.fileKey,
        mimeType: fileInfo.contentType
      })
    };
    
    // 3. 发送消息
    await sendMessage(payload);
  } catch (error) {
    console.error('上传失败:', error);
  }
}
```

### 2. 上传会话头像

```typescript
import { uploadConversationAvatar, getConversationAvatarUrl } from '@/features/chat/api';

async function handleAvatarUpload(file: File) {
  const conversationId = currentConversation.value.id;
  
  try {
    // 1. 上传头像
    const response = await uploadConversationAvatar(conversationId, file);
    const avatarKey = response.data.key;
    
    // 2. 更新会话信息
    await updateConversation(conversationId, {
      avatarKey: avatarKey
    });
    
    // 3. 刷新会话列表
    await loadConversations();
  } catch (error) {
    console.error('头像上传失败:', error);
  }
}

// 获取头像URL
const avatarUrl = computed(() => {
  if (!currentConversation.value?.avatarKey) return '';
  return getConversationAvatarUrl(
    currentConversation.value.id,
    currentConversation.value.avatarKey
  );
});
```

### 3. 在模板中显示文件消息

```vue
<template>
  <!-- 图片消息 -->
  <img 
    v-if="message.messageType === 'image'"
    :src="parseMessageExtra(message.extra)?.fileUrl"
    alt="图片"
  />
  
  <!-- 视频消息 -->
  <video 
    v-else-if="message.messageType === 'video'"
    :src="parseMessageExtra(message.extra)?.fileUrl"
    controls
  />
  
  <!-- 音频消息 -->
  <audio 
    v-else-if="message.messageType === 'audio'"
    :src="parseMessageExtra(message.extra)?.fileUrl"
    controls
  />
  
  <!-- 文件消息 -->
  <div v-else-if="message.messageType === 'file'">
    <a :href="parseMessageExtra(message.extra)?.fileUrl" download>
      {{ parseMessageExtra(message.extra)?.fileName }}
    </a>
  </div>
</template>

<script setup>
import { parseMessageExtra } from '@/features/chat/utils/fileHelper';
</script>
```

## 隐私保护

### 权限验证流程

1. **身份认证**: 所有请求必须携带有效的JWT Token
2. **成员验证**: 检查用户是否为会话成员 (`ChatConversationMembers` 表中 `LeftAt == null`)
3. **失败响应**: 无权限时返回 404，不暴露文件是否存在

### 安全特性

- 文件按会话物理隔离存储
- 防止目录遍历攻击 (Path.GetFileName)
- 文件类型白名单验证
- SHA256哈希文件名防止冲突
- 非成员无法通过任何方式访问文件

## 注意事项

### URL 规范化

前端API已处理baseUrl末尾斜杠问题，避免生成双斜杠URL：

```typescript
// ✅ 正确
const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
return `${normalizedBaseUrl}/mm/files/chat/${fileKey}`;

// ❌ 错误 - 会产生双斜杠
return `${baseUrl}/mm/files/chat/${fileKey}`;
```

### 图片转换

- 所有上传的图片都会自动转换为WebP格式
- 转换后的文件大小会变化，API返回的 `fileSize` 为0
- 原始文件名保留在 `originalFileName` 字段

### 环境变量配置

确保 `.env` 文件中配置了正确的API基础URL：

```env
VITE_API_BASE_URL=http://192.168.43.33:5210
```

**注意**: URL末尾不要加斜杠

## 故障排查

### 404 Not Found

可能原因：
1. 文件不存在
2. 用户不是会话成员
3. URL格式错误（检查是否有双斜杠）

### 403 Forbidden

可能原因：
1. Token过期或无效
2. 用户已被移出会话

### 400 Bad Request

可能原因：
1. 文件为空
2. 文件超过100MB限制
3. 不支持的文件类型

## 部署清单

- [x] 后端编译成功
- [x] 前端编译成功
- [ ] 重启后端服务
- [ ] 测试图片上传和显示
- [ ] 测试视频上传和播放
- [ ] 测试文档上传和下载
- [ ] 测试群头像上传
- [ ] 验证权限控制（非成员无法访问）
- [ ] 检查文件存储路径是否正确
