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
const currentFileType = computed<FilePreviewType>(() => (
  currentFile.value ? getFileType(currentFile.value) : 'unknown'
))
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

// 视频旋转（视频没有缩放/拖动，只做 90° 旋转 + 自动缩放到容器内）
const videoRotate = ref(0)
const videoFitScale = ref(1)

const MIN_SCALE = 0.2
const MAX_SCALE = 5
const ZOOM_STEP = 0.2

// 元素引用
const imageRefs = ref<Record<number, HTMLImageElement | null>>({})
const imageContainerRefs = ref<Record<number, HTMLDivElement | null>>({})
const videoRefs = ref<Record<number, HTMLVideoElement | null>>({})
const videoContainerRefs = ref<Record<number, HTMLDivElement | null>>({})
const previewOverlayRef = ref<HTMLElement>()
const carouselRef = ref<CarouselInstance>()
const loadedFileKeys = ref<Set<string>>(new Set())

const setImageRef = (index: number) => (el: Element | ComponentPublicInstance | null) => {
  imageRefs.value[index] = el as HTMLImageElement | null
}

const setImageContainerRef = (index: number) => (el: Element | ComponentPublicInstance | null) => {
  imageContainerRefs.value[index] = el as HTMLDivElement | null
}

const setVideoRef = (index: number) => (el: Element | ComponentPublicInstance | null) => {
  videoRefs.value[index] = el as HTMLVideoElement | null
}

const setVideoContainerRef = (index: number) => (el: Element | ComponentPublicInstance | null) => {
  videoContainerRefs.value[index] = el as HTMLDivElement | null
}

const getCurrentImageRef = () => imageRefs.value[currentIndex.value] ?? null
const getCurrentImageContainerRef = () => imageContainerRefs.value[currentIndex.value] ?? null
const getCurrentVideoRef = () => videoRefs.value[currentIndex.value] ?? null
const getCurrentVideoContainerRef = () => videoContainerRefs.value[currentIndex.value] ?? null

const canDragImage = computed(() => (
  !!currentFile.value
  && currentFileType.value === 'image'
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

const clampScale = (value: number) => Math.min(Math.max(value, MIN_SCALE), MAX_SCALE)

const updateScale = (nextScale: number) => {
  const normalizedScale = clampScale(nextScale)
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

// 把屏幕坐标换算成「相对预览容器中心」的坐标。
// 图片默认居中、translate 也是屏幕坐标系里的偏移，所以缩放锚点用这套坐标才对得上。
const toContainerPoint = (clientX: number, clientY: number) => {
  const rect = getCurrentImageContainerRef()?.getBoundingClientRect()
  if (!rect) return null
  return {
    x: clientX - (rect.left + rect.width / 2),
    y: clientY - (rect.top + rect.height / 2),
  }
}

// 以某个屏幕坐标（视口坐标）为锚点缩放，保证手指/鼠标下面的画面位置不动
const setScaleAtPoint = (nextScale: number, clientX: number, clientY: number) => {
  const targetScale = clampScale(nextScale)
  const point = toContainerPoint(clientX, clientY)

  if (!point || targetScale <= 1) {
    updateScale(targetScale)
    return
  }

  const ratio = targetScale / scale.value
  const clamped = clampTranslate(
    point.x - ratio * point.x + ratio * translateX.value,
    point.y - ratio * point.y + ratio * translateY.value,
    targetScale,
    rotate.value,
  )
  scale.value = targetScale
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

// 视频样式：旋转 90°/270° 后画面宽高互换，会顶出预览区，
// 所以叠一个 scale 把它整体压回容器里（见 measureVideoFitScale）。
const videoStyle = computed(() => ({
  transform: `rotate(${videoRotate.value}deg) scale(${videoFitScale.value})`,
}))

const measureVideoFitScale = () => {
  // 180° 只是掉头，外接矩形不变，不需要缩放
  if (videoRotate.value % 180 === 0) return 1

  const video = getCurrentVideoRef()
  const container = getCurrentVideoContainerRef()
  if (!video || !container) return 1

  // clientWidth/Height 是布局尺寸，不受 transform 影响 —— 正好是「旋转前」的画面尺寸。
  // 容器要扣掉内边距（安全区），那部分不算可用空间。
  const computedStyle = window.getComputedStyle(container)
  const containerWidth = container.clientWidth
    - parseFloat(computedStyle.paddingLeft || '0')
    - parseFloat(computedStyle.paddingRight || '0')
  const containerHeight = container.clientHeight
    - parseFloat(computedStyle.paddingTop || '0')
    - parseFloat(computedStyle.paddingBottom || '0')
  const videoWidth = video.clientWidth
  const videoHeight = video.clientHeight
  if (!containerWidth || !containerHeight || !videoWidth || !videoHeight) return 1

  // 旋转 90° 后宽高互换：需要 videoHeight * k <= 容器宽、videoWidth * k <= 容器高
  return Math.min(containerWidth / videoHeight, containerHeight / videoWidth, 1)
}

const refreshVideoFit = () => {
  videoFitScale.value = measureVideoFitScale()
}

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
  // 只有当前这条视频的高度会影响旋转适配比例，别的切片加载完不要乱改
  if (file === currentFile.value) refreshVideoFit()
}

// 拿到视频真实尺寸后才能算出旋转后的适配比例（此时 video.clientWidth 才是画面尺寸）
const handleVideoMetadata = (index: number) => {
  if (index === currentIndex.value) refreshVideoFit()
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
  videoRotate.value = 0
  videoFitScale.value = 1
  stopImageDrag()
}

// 旋转控制：图片转当前缩放/拖动的那张，视频转视频画面
const handleRotate = () => {
  if (currentFileType.value === 'video') {
    videoRotate.value = (videoRotate.value + 90) % 360
    refreshVideoFit()
    return
  }
  if (currentFileType.value !== 'image') return

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

// ===== 移动端手势（图片） =====
// 触屏没有滚轮：双指缩放、单指拖动、双击放大、原始大小下左右滑动翻页都要自己实现。
// 这些值只给事件处理用，不需要响应式（双指缩放时每帧都改，走 ref 反而卡）。
const SWIPE_THRESHOLD = 48 // 横向滑动超过这个距离才翻页（px）
const SWIPE_DIRECTION_RATIO = 0.6 // 纵向位移必须明显小于横向，避免斜着滑也翻页
const TAP_MOVE_TOLERANCE = 10 // 位移小于它算「点按」而不是拖动（px）
const DOUBLE_TAP_DELAY = 300 // 双击间隔（ms）
const DOUBLE_TAP_SCALE = 2 // 双击放大到的倍数

type TouchMode = 'none' | 'pan' | 'pinch' | 'swipe'

let touchMode: TouchMode = 'none'
let touchStartX = 0
let touchStartY = 0
let touchMoved = false
let pinchStartDistance = 0
let pinchStartScale = 1
let pinchStartMidX = 0
let pinchStartMidY = 0
let pinchStartTranslateX = 0
let pinchStartTranslateY = 0
let lastTapTime = 0

const getTouchDistance = (touches: TouchList) => {
  const first = touches[0]
  const second = touches[1]
  if (!first || !second) return 0
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)
}

const getTouchCenter = (touches: TouchList) => {
  const first = touches[0]
  const second = touches[1]
  if (!first || !second) return null
  return {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
  }
}

const resetGestureState = () => {
  touchMode = 'none'
  touchMoved = false
  pinchStartDistance = 0
  lastTapTime = 0
  isDragging.value = false
}

const handleImageTouchStart = (event: TouchEvent, index: number) => {
  if (index !== currentIndex.value || currentFileType.value !== 'image') return
  const touches = event.touches

  if (touches.length >= 2) {
    const center = getTouchCenter(touches)
    const mid = center ? toContainerPoint(center.x, center.y) : null
    touchMode = 'pinch'
    // 关掉 0.3s 过渡，双指缩放才跟手
    isDragging.value = true
    pinchStartDistance = getTouchDistance(touches) || 1
    pinchStartScale = scale.value
    pinchStartMidX = mid?.x ?? 0
    pinchStartMidY = mid?.y ?? 0
    pinchStartTranslateX = translateX.value
    pinchStartTranslateY = translateY.value
    return
  }

  const touch = touches[0]
  if (!touch) return

  touchStartX = touch.clientX
  touchStartY = touch.clientY
  touchMoved = false

  // 已经放大时单指拖动画面（和鼠标拖拽走同一套 clamp）
  if (scale.value > 1) {
    touchMode = 'pan'
    dragStartX.value = touch.clientX
    dragStartY.value = touch.clientY
    dragOriginX.value = translateX.value
    dragOriginY.value = translateY.value
    isDragging.value = true
  } else {
    touchMode = 'swipe'
  }
}

const handleImageTouchMove = (event: TouchEvent, index: number) => {
  if (index !== currentIndex.value || touchMode === 'none') return
  const touches = event.touches

  if (touchMode === 'pinch') {
    if (touches.length < 2) return
    const distance = getTouchDistance(touches)
    if (!distance || !pinchStartDistance) return
    const center = getTouchCenter(touches)
    const mid = center ? toContainerPoint(center.x, center.y) : null

    // 以双指中点为锚点缩放：先算目标倍数，再反推平移量让锚点下的画面不动。
    // 同时双指整体移动也会体现在 mid 上（相当于一边缩放一边拖动）。
    const targetScale = clampScale(pinchStartScale * (distance / pinchStartDistance))
    const ratio = targetScale / pinchStartScale
    scale.value = targetScale

    if (targetScale <= 1) {
      translateX.value = 0
      translateY.value = 0
      return
    }
    if (!mid) return

    const clamped = clampTranslate(
      mid.x - ratio * pinchStartMidX + ratio * pinchStartTranslateX,
      mid.y - ratio * pinchStartMidY + ratio * pinchStartTranslateY,
      targetScale,
      rotate.value,
    )
    translateX.value = clamped.x
    translateY.value = clamped.y
    return
  }

  const touch = touches[0]
  if (!touch) return

  const dx = touch.clientX - touchStartX
  const dy = touch.clientY - touchStartY
  if (Math.abs(dx) > TAP_MOVE_TOLERANCE || Math.abs(dy) > TAP_MOVE_TOLERANCE) {
    touchMoved = true
  }

  if (touchMode === 'pan') {
    const next = clampTranslate(dragOriginX.value + dx, dragOriginY.value + dy)
    translateX.value = next.x
    translateY.value = next.y
  }
}

const handleImageTouchEnd = (event: TouchEvent, index: number) => {
  if (index !== currentIndex.value || touchMode === 'none') return
  const touches = event.touches

  if (touches.length >= 2) return

  // 双指松开一根：用剩下的那根继续拖，避免画面跳到别处
  if (touches.length === 1) {
    const touch = touches[0]
    if (!touch) return
    touchStartX = touch.clientX
    touchStartY = touch.clientY
    touchMoved = false
    if (scale.value > 1) {
      touchMode = 'pan'
      dragStartX.value = touch.clientX
      dragStartY.value = touch.clientY
      dragOriginX.value = translateX.value
      dragOriginY.value = translateY.value
      isDragging.value = true
    } else {
      touchMode = 'swipe'
      isDragging.value = false
    }
    return
  }

  const mode = touchMode
  touchMode = 'none'
  isDragging.value = false

  if (mode === 'pinch') {
    // 缩放结束：回到原始大小时把位移归零，否则画面会停在偏移位置
    if (scale.value <= 1) {
      translateX.value = 0
      translateY.value = 0
    } else {
      requestAnimationFrame(applyTranslateBounds)
    }
    return
  }

  const touch = event.changedTouches[0]
  if (!touch) return

  const dx = touch.clientX - touchStartX
  const dy = touch.clientY - touchStartY

  // 点按：单击不做事，双击在「原始大小 / 2 倍」之间切换，并以手指位置为锚点
  if (!touchMoved && Math.abs(dx) <= TAP_MOVE_TOLERANCE && Math.abs(dy) <= TAP_MOVE_TOLERANCE) {
    const now = Date.now()
    if (now - lastTapTime <= DOUBLE_TAP_DELAY) {
      lastTapTime = 0
      setScaleAtPoint(scale.value > 1 ? 1 : DOUBLE_TAP_SCALE, touch.clientX, touch.clientY)
    } else {
      lastTapTime = now
    }
    return
  }

  // 只有原始大小时的横向滑动才翻页；放大后滑动是拖动画面
  if (
    mode === 'swipe'
    && Math.abs(dx) >= SWIPE_THRESHOLD
    && Math.abs(dy) <= Math.abs(dx) * SWIPE_DIRECTION_RATIO
  ) {
    if (dx < 0) handleNext()
    else handlePrev()
  }
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
  videoRotate.value = 0
  videoFitScale.value = 1
  resetGestureState()
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
//
// ⚠️ 必须 immediate：本组件由父级 `<FilePreview v-if="galleryVisible">` 挂载，
// 挂载时 currentFile 已经有值 —— 不带 immediate 的 watch 只在**之后变化**时触发，
// 于是首次打开时转换不会发生，content 一直是 null，
// `.txt-preview` / `.markdown-preview` 里 v-if="content" 的内容永远不渲染
// （表现为「.md / .txt 预览是空白」）。
watch(
  currentFile,
  (newFile) => {
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
  },
  { immediate: true },
)

// 视口尺寸变化（旋转屏幕、浏览器地址栏收起、软键盘）后重新夹紧位移/视频适配比例，
// 否则图片的拖动范围、视频旋转后的缩放会按旧尺寸算，画面能拖到容器外。
const handleViewportResize = () => {
  requestAnimationFrame(() => {
    if (currentFileType.value === 'image') {
      applyTranslateBounds()
    } else if (currentFileType.value === 'video') {
      refreshVideoFit()
    }
  })
}

// 生命周期
onMounted(() => {
  document.addEventListener('keydown', handleKeyDown)
  document.addEventListener('mousemove', handleDocumentMouseMove)
  document.addEventListener('mouseup', handleDocumentMouseUp)
  window.addEventListener('resize', handleViewportResize)
  window.addEventListener('orientationchange', handleViewportResize)
})

onUnmounted(() => {
  pausePreviewMedia()
  stopImageDrag()
  document.removeEventListener('keydown', handleKeyDown)
  document.removeEventListener('mousemove', handleDocumentMouseMove)
  document.removeEventListener('mouseup', handleDocumentMouseUp)
  window.removeEventListener('resize', handleViewportResize)
  window.removeEventListener('orientationchange', handleViewportResize)
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
                  <!-- 不用 :line-clamp（EP 的 -webkit-inline-box 会让 text-overflow: ellipsis
                       失效），改成普通单行 + CSS 省略号，见 .file-name -->
                  <el-text class="file-name">{{ currentFile?.name }}</el-text>
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

        <!--
          主预览区域。
          左右翻页按钮放在 .preview-stage 里（position: relative），
          这样 top: 50% 是相对「预览区」居中，而不是相对整个网页 ——
          否则上面工具栏占掉的高度会算进去，按钮会明显低于画面中心。
        -->
        <div class="preview-stage">
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

          <el-carousel ref="carouselRef" class="preview-carousel" :autoplay="false" arrow="never"
            indicator-position="none" height="100%" :initial-index="currentIndex" :loop="true" trigger="click"
            @change="handleCarouselChange">
            <el-carousel-item v-for="(file, index) in fileList" :key="`${file.url || file.path}-${index}`">
              <div class="preview-content" :style="contentStyle">
                <div v-if="getFileType(file) === 'image'" :ref="setImageContainerRef(index)" class="image-preview"
                  @wheel.prevent="handleImageWheel($event, index)"
                  @mousedown.prevent="handleImageMouseDown($event, index)"
                  @touchstart="handleImageTouchStart($event, index)"
                  @touchmove.prevent="handleImageTouchMove($event, index)"
                  @touchend="handleImageTouchEnd($event, index)"
                  @touchcancel="handleImageTouchEnd($event, index)">
                  <img v-if="file?.url || file?.path" :ref="setImageRef(index)" :key="file?.url || file?.path"
                    class="preview-image-element" :src="file?.url || file?.path" :alt="file?.name" :style="imageStyle"
                    @load="handleImageLoad(file)" @error="handleImageError" @dragstart.prevent />
                </div>

                <div v-else-if="getFileType(file) === 'video'" :ref="setVideoContainerRef(index)" class="video-preview">
                  <!-- playsinline：iOS 上不加会强制全屏播放，旋转样式就看不见了 -->
                  <video :ref="setVideoRef(index)" :key="file?.url || file?.path" :src="file?.url" :poster="file?.path"
                    :style="videoStyle" controls playsinline webkit-playsinline autoplay preload="metadata"
                    @loadedmetadata="handleVideoMetadata(index)" @loadeddata="handleVideoLoaded(file)" v-videoPlay>
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
        </div>

        <!--
          小屏专用：文件名单独一行。
          工具栏 7 个按钮（折叠/放大/缩小/旋转/重置/下载/关闭）在小屏也有 248px，
          挤在同一行时文件名只剩几十像素，怎么截断都看不出是什么文件。
          这里让它独占一整行，工具栏那一行就只放按钮。
          这个节点始终渲染，靠 CSS 控制只在 rp.compact 下显示（宽屏不显示，避免多占一行）。
        -->
        <div v-if="currentFile?.name" class="file-name-row" :title="currentFile?.name">
          {{ currentFile?.name }}
        </div>

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
@use "@/styles/responsive-mixins" as rp;

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
  // 移动端：文档/图片滚到尽头时不要把滚动传给后面的页面（会露出底下的聊天页）
  overscroll-behavior: contain;
}

// 预览是全屏 fixed 覆盖层，顶部工具栏会压到刘海/状态栏上，
// 所以基态就让开安全区，小屏（含横屏手机）再收紧内边距。
.preview-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0;
  // padding: calc(12px + var(--safe-top)) calc(12px + var(--safe-right)) 12px calc(12px + var(--safe-left));
  background-color: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(10px);
  color: #fff;
  z-index: 10;

  // 小屏（窄或矮）都用更紧的内边距：横屏手机 852x393 也算小屏 ——
  // 全屏看图片时工具栏占掉太多高度就没什么可看的了。
  @include rp.compact(768px) {
    padding: 0;
    // padding: calc(6px + var(--safe-top)) calc(6px + var(--safe-right)) 6px calc(6px + var(--safe-left));
  }
}

.toolbar-left {
  padding-left: 8px;
  display: flex;
  // 让这一侧可以在窄窗口里收缩，否则文件名会把右侧按钮挤出可视区。
  // （本行是 flex 子项，默认 min-width: auto；工具栏是 space-between 布局。）
  min-width: 0;

  .file-name {
    font-size: 13px;
    // 原本写死 max-width: 400px —— 360px 宽的手机上文件名会把工具栏顶破。
    // 用 min() 跟视口联动：宽屏仍是 400px，窄屏按 45vw 收（360px -> 162px）。
    max-width: min(400px, 45vw);
    // 缺这一条时 text-overflow: ellipsis 根本不生效（文字会换行而不是省略），
    // 而且没有空格的长文件名（IMG_20240101_123456.jpg）min-content 就是整串，
    // 换行也救不了，会横向溢出。
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    // el-text 默认是 inline 的，省略号对 inline 元素不生效，必须是块级
    display: block;
    // 作为 .toolbar-left（flex）的子项要能收缩
    min-width: 0;
  }
}

// 小屏专用文件名行：默认不显示，只在 rp.compact 下出现（见文件末尾的适配块）
.file-name-row {
  display: none;
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translate(-50%, 0);
  color: var(--text-color);
  max-width: calc(100vw - 10px);
  padding: 0 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-radius: 5px 5px 0 0;

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    background-color: var(--bg-color);
    opacity: 0.5;
    /* 只调这一层的透明度 */
    z-index: -1;
    pointer-events: none;
    /* 避免挡住点击，视情况加 */
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
  background-color: rgba(var(--theme-color-rgb), 0.18);
  color: #fff;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;

  &:hover {
    background-color: rgba(var(--theme-color-rgb), 0.38);
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
    background-color: rgba(var(--theme-color-rgb), 0.14);

    &:hover {
      border-color: var(--theme-color-strong);
      transform: scale(1.05);
    }

    &.active {
      border-color: var(--theme-color-strong);
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

// 预览舞台：左右翻页按钮的定位基准。
// 之前按钮直接挂在整页覆盖层上，top: 50% 把顶部工具栏的高度也算进去了，
// 按钮会比画面中心低一截；包一层之后按钮相对「预览区」居中。
.preview-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

// 导航按钮（定位基准是 .preview-stage，不是整个网页）
.nav-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 50px;
  height: 50px;
  border: none;
  background-color: rgba(var(--theme-color-rgb), 0.18);
  color: #fff;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  z-index: 10;

  &:hover {
    background-color: rgba(var(--theme-color-rgb), 0.42);
    transform: translateY(-50%) scale(1.1);
  }

  // 触屏没有真正的 hover，点一下就会「粘住」放大态，这里还原
  @include rp.coarse-pointer {
    &:hover {
      background-color: rgba(var(--theme-color-rgb), 0.18);
      transform: translateY(-50%);
    }
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

// 图片预览
.image-preview {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  // 底部同样让开手势条，避免图片被系统手势区压住。
  padding: 0 calc(12px + var(--safe-right)) calc(12px + var(--safe-bottom)) calc(12px + var(--safe-left));
  box-sizing: border-box;

  @include rp.compact(768px) {
    padding: 0 calc(6px + var(--safe-right)) calc(6px + var(--safe-bottom)) calc(6px + var(--safe-left));
  }

  // 触屏手势全部交给 JS（双指缩放 / 拖动画 / 双击放大 / 滑动翻页）：
  // touch-action 不关掉的话，拖动图片会变成滚动页面、双指会缩放整个网页。
  touch-action: none;
  overscroll-behavior: contain;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
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
  // 长按不要弹 iOS 的「存储图片」菜单，否则会和双击/拖动抢手势
  -webkit-touch-callout: none;
  -webkit-user-drag: none;
}

// 视频预览
.video-preview {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  // 横屏刘海在侧边、竖屏手势条在底部，桌面端这两个变量都是 0
  padding: 0 var(--safe-right) var(--safe-bottom) var(--safe-left);
  box-sizing: border-box;

  video {
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    object-fit: contain; // 保证等比完整显示
    outline: none;
    // 旋转 90°/270° 后由 JS 算一个缩放把画面压回容器（见 measureVideoFitScale）
    transform-origin: center center;
    transition: transform 0.3s ease;
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
  font-size: 14px;
  line-height: 1.6;
  color: #1e1e1e;
  /* 浅灰文字 */
  white-space: pre-wrap;
  /* 自动换行 */
  // word-wrap: break-word 对「没有任何断点的长串」（URL、日志、base64）
  // 无效，在 pre-wrap 下依然会横向顶破容器；anywhere 允许任意位置断行。
  overflow-wrap: anywhere;
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
    font-size: 15px;
    margin: 0;
  }

  .download-btn {
    padding: 12px 30px;
    border: none;
    background-color: var(--theme-action-bg);
    color: var(--theme-action-contrast);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.2s;

    &:hover {
      background-color: var(--theme-action-hover);
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
    font-size: 13px;
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
    font-size: 13px;
    margin: 0;
  }

  .retry-btn {
    padding: 8px 24px;
    border: none;
    background-color: var(--theme-action-bg);
    color: var(--theme-action-contrast);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.2s;

    &:hover {
      background-color: var(--theme-action-hover);
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

// ==============================================
// 移动端 / 小屏适配
// ==============================================
// 小屏（窄或矮）下这个组件最容易出问题的是工具栏：
// 7 个按钮 × 36px + 6 × 8px 间距 = 300px，
// 360px 宽的手机上只给文件名留约 40px（320px 上几乎挤没）。
// 按钮缩到 32px（≈EP 默认按钮尺寸，触屏点得中）+ 间距 4px => 248px。
//
// 缩略图条本身在 el-scrollbar 里，横向溢出由它负责滚动，这里只做密度调整。
@include rp.compact(768px) {
  .toolbar-right {
    gap: 4px;
  }

  .toolbar-btn {
    width: 32px;
    height: 32px;
  }

  .toolbar-left {
    padding-left: 4px;
    // 小屏下把文件名从工具栏里拿出去（见下面的 .file-name-row）：
    // 工具栏 7 个按钮（32px）就已经占 248px，同一行留给文件名只剩几十像素，
    // 怎么截断都看不出是什么文件。隐藏后按钮这一行能铺满。
    display: none;
  }

  // 文件名独占一行，拿满宽度，只在真正超长时才出省略号
  .file-name-row {
    display: block;
    // padding: 0 calc(8px + var(--safe-right)) 4px calc(8px + var(--safe-left));
    font-size: 12px;
    color: var(--el-text-color-regular);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  // 缩略图缩小，一屏能多看几张
  .thumbnail-list {
    gap: 6px;
    padding: 6px;

    .thumbnail-item {
      width: 44px;
      height: 44px;
    }
  }

  // 左右翻页按钮：让开安全区（横屏时刘海在侧边），并稍微收小
  .nav-btn {
    width: 44px;
    height: 44px;

    &.prev-btn {
      left: calc(8px + var(--safe-left));
    }

    &.next-btn {
      right: calc(8px + var(--safe-right));
    }
  }

  // 文本预览：24px 内边距在手机上太浪费纵向空间
  .txt-preview {
    padding: 12px;
    border-radius: 8px;

    pre {
      font-size: 12px;
    }
  }

  .markdown-preview {
    border-radius: 8px;

    // Markdown 里的宽表格 / 长代码行在窄屏会顶破容器，
    // 给它们各自的横向滚动，而不是让整个预览区溢出
    :deep(.v-md-editor-preview) {
      table {
        display: block;
        overflow-x: auto;
      }

      pre {
        overflow-x: auto;
      }
    }
  }

  // Office / PDF 渲染器是桌面尺寸的，窄屏给横向滚动兜底，
  // 否则内容会被 preview-content 的 overflow: hidden 直接裁掉
  .document-preview,
  .pdf-preview {
    overflow: auto;
  }

  .unsupported-preview {
    gap: 12px;
    padding: 0 16px;

    p {
      font-size: 13px;
      text-align: center;
    }

    .download-btn {
      padding: 10px 24px;
    }
  }
}
</style>
