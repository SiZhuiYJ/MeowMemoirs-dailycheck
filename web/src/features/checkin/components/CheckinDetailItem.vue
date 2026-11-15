<script setup lang="ts">
import { computed, ref, watch } from "vue";
import FilePreview from "@/components/FilePreview/index.vue";
import type { CheckinDetail } from "@/features/checkin/types";

const props = defineProps<{
  checkinDetail: CheckinDetail;
  imageObjectUrls?: Map<string, string>;
  noStatus?: boolean;
}>();

/** FilePreview 需要的文件条目：打卡图只有图片，只取已经下载好的 blob URL。 */
interface PreviewImage {
  name: string;
  url: string;
  type: "image";
}

function getBlobUrl(url: string): string {
  return props.imageObjectUrls?.get(url) || "";
}

/**
 * 图片是异步下载的（见 CheckinDetailDrawer 的 enqueueImages），没下载完的没有 blob URL。
 * 这里只把已就绪的图片交给预览器，缩略图和全屏预览共用同一份顺序，
 * 所以点击缩略图时的下标可以直接当作预览器的 currentIndex。
 */
const previewImages = computed<PreviewImage[]>(() => {
  const list: PreviewImage[] = [];
  for (const url of props.checkinDetail.imageUrls) {
    const blobUrl = getBlobUrl(url);
    if (!blobUrl) continue;
    list.push({
      name: getImageName(url, list.length + 1),
      url: blobUrl,
      type: "image",
    });
  }
  return list;
});

/**
 * 服务端存的是无扩展名的文件 key，GetImage 返回的是 webp，
 * 所以无名文件统一按 webp 命名（FilePreview 靠 type 判断类型，name 只用于标题和下载）。
 */
function getImageName(url: string, index: number): string {
  const key = url.split("?")[0]?.split("/").filter(Boolean).pop() || "";
  return /\.[a-z0-9]+$/i.test(key) ? key : `打卡图片 ${index}.webp`;
}

const previewVisible = ref(false);
const previewFiles = ref<PreviewImage[]>([]);
const previewIndex = ref(0);

function openPreview(index: number): void {
  // 打开时快照一份列表：预览期间其它图片陆续下载完成也不会改变顺序，
  // 否则新图插到前面会把用户正在看的那张顶掉。
  previewFiles.value = previewImages.value.slice();
  previewIndex.value = index;
  previewVisible.value = true;
}

// 抽屉关闭 / 切换日期会回收全部 blob URL：图片清空后要把预览一起关掉，
// 否则会停在一屏失效地址上，看到的是空白遮罩。
watch(previewImages, (images) => {
  if (!previewVisible.value || images.length) return;
  previewVisible.value = false;
  previewFiles.value = [];
  previewIndex.value = 0;
});
</script>

<template>
  <div class="detail-item">
    <p v-if="!props.noStatus" class="drawer-status">
      状态：
      <span v-if="checkinDetail.status === 1" class="dot success">
        已打卡
      </span>
      <span v-else-if="checkinDetail.status === 2" class="dot retro">
        已补签
      </span>
      <span v-else class="dot unknown">未知</span>
    </p>
    <p v-if="checkinDetail.note" class="drawer-note">
      备注：{{ checkinDetail.note }}
    </p>
    <div v-if="checkinDetail.imageUrls.length" class="image-list">
      <button
        v-for="(image, index) in previewImages"
        :key="image.url"
        type="button"
        class="image-item"
        :aria-label="`预览 ${image.name}`"
        @click="openPreview(index)"
      >
        <img :src="image.url" :alt="image.name" class="detail-image" />
      </button>
    </div>
    <p v-else class="no-images">无图片</p>
    <FilePreview
      v-if="previewVisible"
      v-model="previewVisible"
      v-model:current-index="previewIndex"
      :file-list="previewFiles"
    />
  </div>
</template>

<style scoped lang="scss">
.detail-item {
  border-bottom: 1px solid var(--border-color);
  padding: 0 12px;
}

.detail-item:last-child {
  border-bottom: none;
}

.drawer-status {
  font-size: 13px;
}

.dot {
  padding: 4px;
  border-radius: 8px;
}

.dot.success {
  background: rgba(202, 255, 222, 0.5);
  color: #89ffb6;
}

.dot.retro {
  background: rgba(255, 246, 217, 0.5);
  color: #ffc685;
}

.dot.unknown {
  background: #94a3b8;
}

.drawer-note {
  font-size: 13px;
}

.image-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 0;
}

.image-item {
  padding: 0;
  border: none;
  background: none;
  line-height: 0;
  border-radius: 8px;
  cursor: pointer;
}

.image-item:focus-visible {
  outline: 2px solid var(--theme-primary-bg);
  outline-offset: 2px;
}

.detail-image {
  display: block;
  width: 80px;
  height: 80px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid #4b5563;
}

.no-images {
  font-size: 12px;
  color: var(--text-muted);
}

// 夜间：状态徽标改用半透明深色底 + 亮色文字，避免浅黄/浅绿底上的亮字发灰
html[data-theme="dark"] .detail-item {
  .dot.success {
    background: rgba(34, 197, 94, 0.16);
    color: #86efac;
  }

  .dot.retro {
    background: rgba(234, 179, 8, 0.16);
    color: #fcd34d;
  }

  .dot.unknown {
    background: #334155;
    color: #e2e8f0;
  }
}
</style>
