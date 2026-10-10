# FilePreview 文件预览组件

一个功能完整的全屏文件预览组件,支持图片、视频、音频和文档的在线预览。

## 功能特性

- **多格式支持**
  - 图片: JPG, PNG, GIF, BMP, WebP, SVG, ICO
  - 视频: MP4, WebM, OGG, MOV, AVI, MKV, FLV
  - 音频: MP3, WAV, OGG, AAC, FLAC, WMA
  - PDF文档
  - Office文档: DOC, DOCX, XLS, XLSX, PPT, PPTX (通过Microsoft Online Viewer)
  - 文本文件: TXT, CSV

- **交互功能**
  - 缩放控制 (放大/缩小/重置)
  - 旋转 (90度递增)
  - 键盘导航 (左右箭头切换, ESC关闭, +/-缩放, R旋转)
  - 文件缩略图列表
  - 上一张/下一张导航按钮
  - 文件下载

- **用户体验**
  - 平滑的过渡动画
  - 加载状态提示
  - 错误处理和重试机制
  - 响应式设计
  - 深色主题

## 使用方法

### 基础用法

```vue
<template>
  <div>
    <el-button @click="openPreview">打开预览</el-button>

    <FilePreview
      v-model="visible"
      :file-list="files"
      :current-index="currentIndex"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import FilePreview from '@/components/FilePreview/index.vue'

const visible = ref(false)
const currentIndex = ref(0)
const files = ref([
  {
    name: 'example.jpg',
    url: 'https://example.com/image.jpg'
  }
])

const openPreview = () => {
  visible.value = true
}
</script>
```

### 多文件画廊模式

```vue
<template>
  <FilePreview
    v-model="visible"
    v-model:current-index="currentIndex"
    :file-list="galleryFiles"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import FilePreview from '@/components/FilePreview/index.vue'

const visible = ref(false)
const currentIndex = ref(0)
const galleryFiles = ref([
  { name: 'image1.jpg', url: 'https://example.com/image1.jpg' },
  { name: 'image2.png', url: 'https://example.com/image2.png' },
  { name: 'video.mp4', url: 'https://example.com/video.mp4' },
  { name: 'document.pdf', url: 'https://example.com/document.pdf' }
])
</script>
```

### 事件处理

```vue
<template>
  <FilePreview
    v-model="visible"
    :file-list="files"
    @close="handleClose"
    @update:current-index="handleIndexChange"
  />
</template>

<script setup lang="ts">
const handleClose = () => {
  console.log('预览已关闭')
}

const handleIndexChange = (index: number) => {
  console.log('当前索引:', index)
}
</script>
```

## Props

| 参数 | 说明 | 类型 | 默认值 |
|------|------|------|--------|
| modelValue | 是否显示预览 | boolean | false |
| fileList | 文件列表 | FileItem[] | [] |
| currentIndex | 当前显示的文件索引 | number | 0 |

### FileItem 类型

```typescript
interface FileItem {
  name: string      // 文件名
  url?: string      // 文件URL
  path?: string     // 文件路径(与url二选一)
  type?: string     // 文件类型(可选,会自动检测)
}
```

## Events

| 事件名 | 说明 | 回调参数 |
|--------|------|----------|
| update:modelValue | 显示状态变化 | (value: boolean) |
| update:currentIndex | 当前索引变化 | (index: number) |
| close | 关闭预览时触发 | - |

## 键盘快捷键

| 按键 | 功能 |
|------|------|
| ESC | 关闭预览 |
| ← | 上一个文件 |
| → | 下一个文件 |
| + / = | 放大 |
| - | 缩小 |
| 0 | 重置缩放 |
| R | 旋转 |

## 注意事项

1. **Office文档预览**: 使用Microsoft Office Online Viewer,需要文件URL可公开访问
2. **跨域问题**: 确保文件服务器配置了正确的CORS头
3. **大文件**: 对于大文件建议先显示加载状态
4. **移动端**: 组件在移动端设备上也能正常工作,但建议针对小屏幕优化UI

## 示例

查看 `example.vue` 文件获取完整的使用示例。
