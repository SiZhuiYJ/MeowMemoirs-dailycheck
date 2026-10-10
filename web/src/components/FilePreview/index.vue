<script setup lang="ts">
// web/src/components/FilePreview/index.vue
import { defineAsyncComponent, ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import type { CarouselInstance } from 'element-plus'
import { ArrowDown, ArrowUp } from '@element-plus/icons-vue'
import { MiniAudioPlayer } from '../MiniAudioPlayer/index'
import SvgIcon from '@/components/SvgIcon/index.vue';

const OfficeDocxPreview = defineAsyncComponent(() => import('./renderers/officeDocx'))
const OfficePptxPreview = defineAsyncComponent(() => import('./renderers/officePptx'))
const OfficeExcelPreview = defineAsyncComponent(() => import('./renderers/officeExcel'))
const OfficePdfPreview = defineAsyncComponent(() => import('./renderers/officePdf'))
const MarkdownPreview = defineAsyncComponent(() => import('@/components/MDPreview/preview'))

interface FileItem {
  name: string
  url?: string
  path?: string
  type?: string
}

type FilePreviewType =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'word'
  | 'excel'
  | 'pptx'
  | 'text'
  | 'md'
  | 'doc'
  | 'xls'
  | 'ppt'
  | 'unknown'

interface Props {
  modelValue: boolean
  fileList: FileItem[]
  currentIndex?: number
}

// 折叠面板状态
const activeNames = ref(['1'])

// 状态管理
const visible = defineModel<boolean>({ required: true })
const currentIndex = defineModel<number>('currentIndex', { required: true })

const props = withDefaults(defineProps<Props>(), {
  currentIndex: 0,
})

const emit = defineEmits<{
  close: []
}>()

const currentFile = computed(() => props.fileList[currentIndex.value])
const loading = ref(false)
const error = ref('')

// 缩放和旋转状态
const scale = ref(1)
const rotate = ref(0)
const translateX = ref(0)
const translateY = ref(0)
const isDragging = ref(false)
const dragStartX = ref(0)
const dragStartY = ref(0)
const dragOriginX = ref(0)
const dragOriginY = ref(0)

const MIN_SCALE = 0.2
const MAX_SCALE = 5
const ZOOM_STEP = 0.2

// 元素引用
const imageRefs = ref<Record<number, HTMLImageElement | null>>({})
const imageContainerRefs = ref<Record<number, HTMLDivElement | null>>({})
const previewOverlayRef = ref<HTMLElement>()
const carouselRef = ref<CarouselInstance>()
const loadedFileKeys = ref<Set<string>>(new Set())

const setImageRef = (index: number) => (el: Element | ComponentPublicInstance | null) => {
  imageRefs.value[index] = el as HTMLImageElement | null
}

const setImageContainerRef = (index: number) => (el: Element | ComponentPublicInstance | null) => {
  imageContainerRefs.value[index] = el as HTMLDivElement | null
}

const getCurrentImageRef = () => imageRefs.value[currentIndex.value] ?? null
const getCurrentImageContainerRef = () => imageContainerRefs.value[currentIndex.value] ?? null

const canDragImage = computed(() => (
  !!currentFile.value
  && getFileType(currentFile.value) === 'image'
  && scale.value > 1
))

const getDragBounds = (targetScale = scale.value, targetRotate = rotate.value) => {
  const image = getCurrentImageRef()
  const container = getCurrentImageContainerRef()

  if (!image || !container) {
    return { maxX: 0, maxY: 0 }
  }

  const normalizedRotate = ((targetRotate % 360) + 360) % 360
  const rotated = normalizedRotate % 180 !== 0
  const baseWidth = image.clientWidth
  const baseHeight = image.clientHeight
  const scaledWidth = (rotated ? baseHeight : baseWidth) * targetScale
  const scaledHeight = (rotated ? baseWidth : baseHeight) * targetScale

  return {
    maxX: Math.max((scaledWidth - container.clientWidth) / 2, 0),
    maxY: Math.max((scaledHeight - container.clientHeight) / 2, 0),
  }
}

const clampTranslate = (
  nextX = translateX.value,
  nextY = translateY.value,
  targetScale = scale.value,
  targetRotate = rotate.value,
) => {
  const { maxX, maxY } = getDragBounds(targetScale, targetRotate)

  return {
    x: Math.min(Math.max(nextX, -maxX), maxX),
    y: Math.min(Math.max(nextY, -maxY), maxY),
  }
}

const applyTranslateBounds = () => {
  const clamped = clampTranslate()
  translateX.value = clamped.x
  translateY.value = clamped.y
}

const stopImageDrag = () => {
  isDragging.value = false
}

const updateScale = (nextScale: number) => {
  const normalizedScale = Math.min(Math.max(nextScale, MIN_SCALE), MAX_SCALE)
  scale.value = normalizedScale

  if (normalizedScale <= 1) {
    translateX.value = 0
    translateY.value = 0
    stopImageDrag()
    return
  }

  const clamped = clampTranslate(translateX.value, translateY.value, normalizedScale, rotate.value)
  translateX.value = clamped.x
  translateY.value = clamped.y
}

const handlePdfRendered = (file?: FileItem) => {
  markFileLoaded(file)
  loading.value = false
}

const handleNativePdfLoaded = (file?: FileItem) => {
  markFileLoaded(file)
  loading.value = false
}

// 获取文件类型
const fileTypeMap: Record<string, FilePreviewType> = {
  image: 'image',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  bmp: 'image',
  webp: 'image',
  svg: 'image',
  ico: 'image',
  video: 'video',
  mp4: 'video',
  webm: 'video',
  ogv: 'video',
  mov: 'video',
  avi: 'video',
  mkv: 'video',
  flv: 'video',
  audio: 'audio',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  aac: 'audio',
  flac: 'audio',
  wma: 'audio',
  pdf: 'pdf',
  word: 'word',
  docx: 'word',
  excel: 'excel',
  xlsx: 'excel',
  pptx: 'pptx',
  text: 'text',
  txt: 'text',
  csv: 'text',
  md: 'md',
  markdown: 'md',
  doc: 'doc',
  xls: 'xls',
  ppt: 'ppt',
  unknown: 'unknown',
}

const getFileType = (file: FileItem): FilePreviewType => {
  const rawType = file.type?.toLowerCase()
  if (rawType && rawType !== 'document') {
    const normalizedType = fileTypeMap[rawType]
    if (normalizedType) return normalizedType
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  return fileTypeMap[ext] ?? 'unknown'
}

const getFileIconType = (type: FilePreviewType) => {
  if (type === 'xls') return 'excel'
  return type
}

const getFileCacheKey = (file?: FileItem) =>
  file?.url || file?.path || (file ? `${file.name}-${file.type || 'unknown'}` : '')

const isFileLoaded = (file?: FileItem) => {
  const key = getFileCacheKey(file)
  return key ? loadedFileKeys.value.has(key) : false
}

const markFileLoaded = (file?: FileItem) => {
  const key = getFileCacheKey(file)
  if (key) {
    loadedFileKeys.value.add(key)
  }
}

// 图片样式
const imageStyle = computed(() => ({
  transform: `translate3d(${translateX.value}px, ${translateY.value}px, 0) rotate(${rotate.value}deg) scale(${scale.value})`,
  transition: isDragging.value ? 'none' : 'transform 0.3s ease'
}))

// 内容区域样式
const contentStyle = computed(() => ({
  cursor: isDragging.value ? 'grabbing' : canDragImage.value ? 'grab' : 'default'
}))


const getLegacyFileMessage = (type: string) => {
  if (type === 'doc') return '此文件为旧版 .doc 格式，暂不支持在线预览，请下载后查看。'
  if (type === 'xls') return '此文件为旧版 .xls 格式，暂不支持在线预览。'
  if (type === 'ppt') return '此文件为旧版 .ppt 格式，暂不支持在线预览。'
  return '该文件类型暂不支持在线预览'
}

const handleOfficeError = (err: Error) => {
  console.error('Office 预览失败:', err)
  error.value = '文档加载失败，可能文件已损坏或格式不兼容'
}
const handleImageError = () => {
  loading.value = false
  error.value = '图片加载失败'
}
// 处理图片加载
const handleImageLoad = (file?: FileItem) => {
  markFileLoaded(file)
  loading.value = false
  requestAnimationFrame(() => {
    applyTranslateBounds()
  })
}

// 处理音频加载完成
const handleAudioLoaded = (file?: FileItem) => {
  markFileLoaded(file)
  loading.value = false
}

// 处理视频加载完成
const handleVideoLoaded = (file?: FileItem) => {
  markFileLoaded(file)
  loading.value = false
}

// 缩放控制
const handleZoomIn = () => {
  updateScale(scale.value + ZOOM_STEP)
}

const handleZoomOut = () => {
  updateScale(scale.value - ZOOM_STEP)
}

const handleResetZoom = () => {
  scale.value = 1
  rotate.value = 0
  translateX.value = 0
  translateY.value = 0
  stopImageDrag()
}

// 旋转控制
const handleRotate = () => {
  rotate.value = (rotate.value + 90) % 360
  requestAnimationFrame(() => {
    applyTranslateBounds()
  })
}

const handleImageWheel = (event: WheelEvent, index: number) => {
  const file = props.fileList[index]
  if (!file || index !== currentIndex.value || getFileType(file) !== 'image') return

  const delta = event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP
  updateScale(scale.value + delta)
}

const handleImageMouseDown = (event: MouseEvent, index: number) => {
  if (index !== currentIndex.value || !canDragImage.value) return

  dragStartX.value = event.clientX
  dragStartY.value = event.clientY
  dragOriginX.value = translateX.value
  dragOriginY.value = translateY.value
  isDragging.value = true
}

const handleDocumentMouseMove = (event: MouseEvent) => {
  if (!isDragging.value) return

  const next = clampTranslate(
    dragOriginX.value + event.clientX - dragStartX.value,
    dragOriginY.value + event.clientY - dragStartY.value,
  )

  translateX.value = next.x
  translateY.value = next.y
}

const handleDocumentMouseUp = () => {
  stopImageDrag()
}

// 导航控制
const handlePrev = () => {
  if (!props.fileList.length) return
  const nextIndex = currentIndex.value <= 0 ? props.fileList.length - 1 : currentIndex.value - 1
  currentIndex.value = nextIndex
  carouselRef.value?.setActiveItem(nextIndex)
  resetPreview()
}

const handleNext = () => {
  if (!props.fileList.length) return
  const nextIndex = currentIndex.value >= props.fileList.length - 1 ? 0 : currentIndex.value + 1
  currentIndex.value = nextIndex
  carouselRef.value?.setActiveItem(nextIndex)
  resetPreview()
}

const handleSwitchFile = (index: number) => {
  if (index === currentIndex.value) return
  currentIndex.value = index
  carouselRef.value?.setActiveItem(index)
  resetPreview()
}

const handleCarouselChange = (index: number) => {
  if (index === currentIndex.value) return
  currentIndex.value = index
  resetPreview()
}

const content = ref<string | null>(null);

async function convertBlobUrl() {
  loading.value = true;
  content.value = null;
  if (currentFile.value?.url) {
    try {
      const text = await blobUrlToString(currentFile.value?.url);
      content.value = text;
    } catch (err: any) {
      console.error(err.message || '转换失败');
    } finally {
      loading.value = false;
    }
  }
}

/**
 * 将 blob URL 对应的内容读取为字符串
 * @param blobUrl blob:// 协议的 URL
 * @returns 解析后的字符串
 * @throws 当 fetch 失败或响应无效时抛出错误
 */
async function blobUrlToString(blobUrl: string): Promise<string> {
  const response = await fetch(blobUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch blob: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

// 重置预览状态
const resetPreview = () => {
  scale.value = 1
  rotate.value = 0
  translateX.value = 0
  translateY.value = 0
  stopImageDrag()
  pausePreviewMedia()
}

// 关闭预览
const pausePreviewMedia = () => {
  const mediaElements = previewOverlayRef.value?.querySelectorAll('video, audio')
  mediaElements?.forEach((media) => (media as HTMLMediaElement).pause())
}

const handleClose = () => {
  visible.value = false
  emit('close')
  resetPreview()
  // 暂停视频播放
  pausePreviewMedia()
}

// 下载文件
const handleDownload = () => {
  if (!currentFile.value) return

  const url = currentFile.value.url || currentFile.value.path
  if (!url) return

  const link = document.createElement('a')
  link.href = url
  link.download = currentFile.value.name
  link.click()
}

const handleDownloadFor = (file: FileItem) => {
  const url = file.url || file.path
  if (!url) return

  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
}

// 重试
const handleRetry = () => {
  error.value = ''
  loading.value = true
  // 重新加载当前文件
  const imageRef = getCurrentImageRef()
  if (imageRef) {
    imageRef.src = ''
    setTimeout(() => {
      if (imageRef && currentFile.value) {
        imageRef.src = currentFile.value.url || currentFile.value.path || ''
      }
    }, 100)
  }
}

// 键盘事件处理
const handleKeyDown = (e: KeyboardEvent) => {
  if (!visible.value) return

  switch (e.key) {
    case 'Escape':
      handleClose()
      break
    case 'ArrowLeft':
      handlePrev()
      break
    case 'ArrowRight':
      handleNext()
      break
    case '+':
    case '=':
      handleZoomIn()
      break
    case '-':
      handleZoomOut()
      break
    case '0':
      handleResetZoom()
      break
    case 'r':
    case 'R':
      handleRotate()
      break
  }
}

// 监听文件变化
watch(currentIndex, (newIndex) => {
  carouselRef.value?.setActiveItem(newIndex)
  resetPreview()
})

// 监听当前文件变化，确保 loading 状态正确
watch(currentFile, (newFile) => {
  if (newFile) {
    const type = getFileType(newFile)
    if (type === 'audio' || type === 'video') {
      loading.value = !isFileLoaded(newFile)
    } else if (type === 'image') {
      loading.value = !isFileLoaded(newFile)
    } else if (type === 'text' || type === 'md') {
      // 调用文本加载函数
      convertBlobUrl();
    } else if (type === 'pdf') {
      loading.value = !isFileLoaded(newFile)
    } else {
      // 其他类型（PDF、文档等）立即隐藏 loading
      loading.value = false
    }
  }
})

// 生命周期
onMounted(() => {
  document.addEventListener('keydown', handleKeyDown)
  document.addEventListener('mousemove', handleDocumentMouseMove)
  document.addEventListener('mouseup', handleDocumentMouseUp)
})

onUnmounted(() => {
  pausePreviewMedia()
  stopImageDrag()
  document.removeEventListener('keydown', handleKeyDown)
  document.removeEventListener('mousemove', handleDocumentMouseMove)
  document.removeEventListener('mouseup', handleDocumentMouseUp)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="preview-fade">
      <div ref="previewOverlayRef" v-show="visible" class="file-preview-overlay" @click.self="handleClose">
        <!-- 顶部工具栏 -->
        <div class="preview-toolbar">
          <el-collapse v-model="activeNames" style="width: 100%;">
            <el-collapse-item :title="currentFile?.name" name="1">
              <template #title>
                <div class="toolbar-left">
                  <el-text class="file-name" :line-clamp="1">{{ currentFile?.name }}</el-text>
                </div>
              </template>

              <template #icon="{ isActive }">
                <div class="toolbar-right">
                  <button class="toolbar-btn" :title="isActive ? '折叠' : '展开'">
                    <el-icon :size="20">
                      <ArrowUp v-if="isActive" />
                      <ArrowDown v-else />
                    </el-icon>

                  </button>
                  <button class="toolbar-btn" @click.stop="handleZoomIn" title="放大">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                      <path fill="currentColor"
                        d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                      <path fill="currentColor" d="M12 10h-2v2H9v-2H7V9h2V7h1v2h2v1z" />
                    </svg>
                  </button>
                  <button class="toolbar-btn" @click.stop="handleZoomOut" title="缩小">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                      <path fill="currentColor"
                        d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                      <path fill="currentColor" d="M7 9h5v1H7z" />
                    </svg>
                  </button>
                  <button class="toolbar-btn" @click.stop="handleRotate" title="旋转">
                    <svg viewBox="0 0 24 24" width="20" height="20" style="transform: rotateY(180deg);">
                      <path fill="currentColor"
                        d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
                    </svg>
                  </button>
                  <button class="toolbar-btn" @click.stop="handleResetZoom" title="重置缩放">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                      <path fill="currentColor"
                        d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
                    </svg>
                  </button>
                  <button class="toolbar-btn" @click.stop="handleDownload" title="下载">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                      <path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                    </svg>
                  </button>
                  <button class="toolbar-btn close-btn" @click.stop="handleClose" title="关闭">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                      <path fill="currentColor"
                        d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                    </svg>
                  </button>
                </div>
              </template>

              <template #default>
                <el-scrollbar>
                  <div v-if="fileList.length > 1" class="thumbnail-list">
                    <button v-for="(file, index) in fileList" :key="index" class="thumbnail-item"
                      :class="{ active: currentIndex === index }" @click="handleSwitchFile(index)">
                      <img v-if="getFileType(file) === 'image'" :src="file.path || file.url" :alt="file.name" />
                      <div v-else-if="getFileType(file) === 'video' || getFileType(file) === 'audio'"
                        class="thumbnail-media" :style="`background-image: url(${file.path}); `">
                        <svg-icon :icon-class="getFileType(file) === 'video' ? 'general-play' : 'general-music'"
                          size="24px" color="#ffffff" />
                      </div>
                      <div v-else class="thumbnail-icon" style="background-color: rgb(255 255 255)">
                        <svg-icon v-if="getFileType(file)"
                          :icon-class="'document-' + getFileIconType(getFileType(file))" size="48px" />
                      </div>
                    </button>
                  </div>
                </el-scrollbar>
              </template>
            </el-collapse-item>
          </el-collapse>
        </div>

        <!-- 上一张/下一张按钮 -->
        <button v-if="fileList.length > 1" class="nav-btn prev-btn" @click="handlePrev">
          <svg viewBox="0 0 24 24" width="32" height="32">
            <path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
          </svg>
        </button>
        <button v-if="fileList.length > 1" class="nav-btn next-btn" @click="handleNext">
          <svg viewBox="0 0 24 24" width="32" height="32">
            <path fill="currentColor" d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
          </svg>
        </button>

        <!-- 主预览区域 -->
        <el-carousel ref="carouselRef" class="preview-carousel" :autoplay="false" arrow="never"
          indicator-position="none" height="100%" :initial-index="currentIndex" :loop="true" trigger="click"
          @change="handleCarouselChange">
          <el-carousel-item v-for="(file, index) in fileList" :key="`${file.url || file.path}-${index}`">
            <div class="preview-content" :style="contentStyle">
              <div v-if="getFileType(file) === 'image'" :ref="setImageContainerRef(index)" class="image-preview"
                @wheel.prevent="handleImageWheel($event, index)"
                @mousedown.prevent="handleImageMouseDown($event, index)">
                <img v-if="file?.url || file?.path" :ref="setImageRef(index)" :key="file?.url || file?.path"
                  class="preview-image-element" :src="file?.url || file?.path" :alt="file?.name" :style="imageStyle"
                  @load="handleImageLoad(file)" @error="handleImageError" @dragstart.prevent />
              </div>

              <div v-else-if="getFileType(file) === 'video'" class="video-preview">
                <video :key="file?.url || file?.path" :src="file?.url" :poster="file?.path" controls autoplay
                  preload="metadata" @loadeddata="handleVideoLoaded(file)" v-videoPlay>
                  您的浏览器不支持视频播放
                </video>
              </div>

              <div v-else-if="getFileType(file) === 'audio'" class="audio-preview" :title="file?.url">
                <MiniAudioPlayer v-if="file?.url" :key="file.url" :url="file.url" :title="file?.name"
                  :cover-url="file.path" @loaded="handleAudioLoaded(file)" />
              </div>

              <div v-else-if="getFileType(file) === 'word' && file?.url" class="document-preview">
                <OfficeDocxPreview :src="file.url" class="docx-class" @rendered="() => { console.log('渲染完成') }"
                  @error="handleOfficeError" />
              </div>

              <div v-else-if="getFileType(file) === 'excel' && file?.url" class="document-preview">
                <OfficeExcelPreview :src="file.url" class="xlsx-class" @rendered="() => { console.log('渲染完成') }"
                  @error="handleOfficeError" />
              </div>

              <div v-else-if="getFileType(file) === 'pptx' && file?.url" class="document-preview">
                <OfficePptxPreview :src="file.url" class="pptx-class" @rendered="() => { console.log('渲染完成') }"
                  @error="handleOfficeError" style="height: 100%;" />
              </div>

              <div v-else-if="getFileType(file) === 'pdf' && file?.url" class="pdf-preview">
                <object :data="file.url" type="application/pdf" width="100%" height="100%"
                  @load="handleNativePdfLoaded(file)">
                  <div class="vue-pdf">
                    <OfficePdfPreview :src="file.url" class="pdf-class" @rendered="handlePdfRendered(file)"
                      @error="handleOfficeError" />
                  </div>
                </object>
              </div>

              <div v-else-if="getFileType(file) === 'text'" class="txt-preview">
                <pre v-if="index === currentIndex && content">{{ content }}</pre>
              </div>

              <div v-else-if="getFileType(file) === 'md'" class="markdown-preview">
                <el-scrollbar>
                  <MarkdownPreview v-if="index === currentIndex && content" :text="content" />
                </el-scrollbar>
              </div>

              <div v-else-if="['doc', 'xls', 'ppt'].includes(getFileType(file))" class="unsupported-preview">
                <div class="unsupported-icon">
                  <svg viewBox="0 0 24 24" width="80" height="80">
                    <path fill="currentColor"
                      d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 15h8v2H8v-2zm0-4h8v2H8v-2z" />
                  </svg>
                </div>
                <p>{{ getLegacyFileMessage(getFileType(file)) }}</p>
                <button class="download-btn" @click="handleDownloadFor(file)">下载文件</button>
              </div>

              <div v-else class="unsupported-preview">
                <div class="unsupported-icon">
                  <svg viewBox="0 0 24 24" width="120" height="120">
                    <path fill="currentColor"
                      d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 15h8v2H8v-2zm0-4h8v2H8v-2z" />
                  </svg>
                </div>
                <p>该文件类型暂不支持在线预览</p>
                <button class="download-btn" @click="handleDownloadFor(file)">
                  下载文件
                </button>
              </div>
            </div>
          </el-carousel-item>
        </el-carousel>

        <!-- 加载状态 -->
        <div v-if="loading" class="loading-overlay">
          <div class="loading-spinner"></div>
          <p>加载中...</p>
        </div>

        <!-- 错误提示 -->
        <div v-if="error" class="error-overlay">
          <div class="error-icon">
            <svg viewBox="0 0 24 24" width="64" height="64">
              <path fill="currentColor"
                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
            </svg>
          </div>
          <p>{{ error }}</p>
          <button class="retry-btn" @click="handleRetry">重试</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
.file-preview-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  background-color: rgba(255, 255, 255, 0.8);
  display: flex;
  flex-direction: column;
}

// 顶部工具栏
.preview-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background-color: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(10px);
  color: #fff;
  z-index: 10;

  @media (max-width: 768px) {
    padding: 6px
  }
}

.toolbar-left {
  padding-left: 8px;
  display: flex;

  .file-name {
    font-size: 14px;
    max-width: 400px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.toolbar-right {
  display: flex;
  gap: 8px;
}

.toolbar-btn {
  width: 36px;
  height: 36px;
  border: none;
  background-color: rgba(0, 0, 0, 0.1);
  color: #fff;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;

  &:hover {
    background-color: rgba(0, 0, 0, 0.2);
    transform: scale(1.05);
  }

  &.close-btn:hover {
    background-color: rgba(255, 0, 0, 0.3);
  }
}

// 缩略图列表
.thumbnail-list {
  display: flex;
  gap: 8px;
  padding: 10px;

  .thumbnail-item {
    flex-shrink: 0;
    width: 60px;
    height: 60px;
    border: 2px solid transparent;
    border-radius: 4px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.2s;
    background-color: rgba(255, 255, 255, 0.1);

    &:hover {
      border-color: rgba(255, 255, 255, 0.5);
      transform: scale(1.05);
    }

    &.active {
      border-color: #409eff;
    }

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .thumbnail-media {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background-size: cover;
      background-position: center center;
    }

    .thumbnail-icon {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: rgba(255, 255, 255, 0.6);
    }
  }
}

// 导航按钮
.nav-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 50px;
  height: 50px;
  border: none;
  background-color: rgba(0, 0, 0, 0.1);
  color: #fff;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  z-index: 10;

  &:hover {
    background-color: rgba(0, 0, 0, 0.6);
    transform: translateY(-50%) scale(1.1);
  }

  &.prev-btn {
    left: 20px;
  }

  &.next-btn {
    right: 20px;
  }
}

// 主预览区域
.preview-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden; // 防止内容溢出被裁剪
  position: relative;

  // 隐藏滚动条但保留滚动功能
  scrollbar-width: none; // Firefox
  -ms-overflow-style: none; // IE/Edge

  &::-webkit-scrollbar {
    display: none; // Chrome/Safari
  }
}

.preview-carousel {
  flex: 1;
  min-height: 0;
}

:deep(.preview-carousel .el-carousel__container) {
  height: 100%;
}

:deep(.preview-carousel .el-carousel__item) {
  display: flex;
}

.carousel-slide-placeholder {
  width: 100%;
  height: 100%;
}

// 图片预览
.image-preview {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 0 12px 12px;
  ;
  box-sizing: border-box;

  @media (max-width: 768px) {
    padding: 0 6px 6px;
  }
}

.preview-image-element {
  display: block;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  transform-origin: center center;
  cursor: inherit;
  user-select: none;
  will-change: transform;
}

// 视频预览
.video-preview {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;

  video {
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    object-fit: contain; // 保证等比完整显示
    outline: none;
  }
}

// 音频预览
.audio-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

// PDF预览
.pdf-preview {
  width: 100%;
  height: 100%;

  .vue-pdf {
    width: 100%;
    height: 100%;
    // 垂直滚动条
    overflow-x: auto;
  }
}

/* ---------- 文本预览样式（核心） ---------- */
.txt-preview {
  width: 100%;
  height: 100%;
  background: #ffffff;
  border-radius: 12px;
  overflow: auto;
  padding: 24px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.txt-preview pre {
  margin: 0;
  font-family: 'Fira Code', 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 15px;
  line-height: 1.6;
  color: #1e1e1e;
  /* 浅灰文字 */
  white-space: pre-wrap;
  /* 自动换行 */
  word-wrap: break-word;
  tab-size: 4;
  -moz-tab-size: 4;
}

.markdown-preview {
  width: 100%;
  height: 100%;
  background: #ffffff;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  overflow: hidden;

  :deep(.v-md-editor-preview) {
    // padding: 24px;
    height: 100%;
    overflow: auto;
    box-sizing: border-box;
  }
}

/* 自定义滚动条（与整体风格一致） */
.xlsx-class::-webkit-scrollbar,
.pptx-class::-webkit-scrollbar,
.docx-class::-webkit-scrollbar,
.vue-pdf::-webkit-scrollbar,
.txt-preview::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.xlsx-class::-webkit-scrollbar-corner,
.xlsx-class::-webkit-scrollbar-track,
.vue-pdf::-webkit-scrollbar-corner,
.vue-pdf::-webkit-scrollbar-track,
.pptx-class::-webkit-scrollbar-corner,
.pptx-class::-webkit-scrollbar-track,
.docx-class::-webkit-scrollbar-corner,
.docx-class::-webkit-scrollbar-track,
.txt-preview::-webkit-scrollbar-corner,
.txt-preview::-webkit-scrollbar-track {
  background: #d2d2d2;
  border-radius: 4px;
}

.xlsx-class::-webkit-scrollbar-thumb,
.pptx-class::-webkit-scrollbar-thumb,
.docx-class::-webkit-scrollbar-thumb,
.vue-pdf::-webkit-scrollbar-thumb,
.txt-preview::-webkit-scrollbar-thumb {
  background: #555;
  border-radius: 4px;
}

.xlsx-class::-webkit-scrollbar-thumb:active,
.xlsx-class::-webkit-scrollbar-thumb:hover,
.pptx-class::-webkit-scrollbar-thumb:active,
.pptx-class::-webkit-scrollbar-thumb:hover,
.docx-class::-webkit-scrollbar-thumb:active,
.docx-class::-webkit-scrollbar-thumb:hover,
.vue-pdf::-webkit-scrollbar-thumb:active,
.vue-pdf::-webkit-scrollbar-thumb:hover,
.txt-preview::-webkit-scrollbar-thumb:active,
.txt-preview::-webkit-scrollbar-thumb:hover {
  background: #777;
}

// 文档预览
.document-preview {
  width: 100%;
  height: 100%;
}

// 不支持的文件类型
.unsupported-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  color: #fff;

  .unsupported-icon {
    color: rgba(255, 255, 255, 0.4);
  }

  p {
    font-size: 16px;
    margin: 0;
  }

  .download-btn {
    padding: 12px 30px;
    border: none;
    background-color: #409eff;
    color: #fff;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;

    &:hover {
      background-color: #66b1ff;
      transform: translateY(-2px);
    }
  }
}

// 加载状态
.loading-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: #fff;
  z-index: 20;

  .loading-spinner {
    width: 50px;
    height: 50px;
    border: 4px solid rgba(255, 255, 255, 0.2);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  p {
    font-size: 14px;
    margin: 0;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

// 错误提示
.error-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: #fff;
  z-index: 20;

  .error-icon {
    color: #f56c6c;
  }

  p {
    font-size: 14px;
    margin: 0;
  }

  .retry-btn {
    padding: 8px 24px;
    border: none;
    background-color: #409eff;
    color: #fff;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;

    &:hover {
      background-color: #66b1ff;
    }
  }
}

// 过渡动画
.preview-fade-enter-active,
.preview-fade-leave-active {
  transition: opacity 0.3s ease;
}

.preview-fade-enter-from,
.preview-fade-leave-to {
  opacity: 0;
}

:deep(.pptx-preview-wrapper) {
  height: 100% !important;
}

:deep(.el-collapse-item__content) {
  padding-bottom: 0px !important;
}
</style>
