<script setup lang="ts">
import ImagePreviewList from "@/features/file/components/ImagePreviewList.vue";
import type { CheckinDetail } from "@/features/checkin/types";
const props = defineProps<{
  checkinDetail: CheckinDetail;
  imageObjectUrls?: Map<string, string>;
  noStatus?: boolean;
}>();
function getBlobUrl(url: string): string {
  return props.imageObjectUrls?.get(url) || "";
}
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
    <div v-if="checkinDetail.imageUrls.length">
      <ImagePreviewList
        :sources="
          checkinDetail.imageUrls.map((url) => getBlobUrl(url)).filter(Boolean)
        "
      />
    </div>
    <p v-else class="no-images">无图片</p>
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
