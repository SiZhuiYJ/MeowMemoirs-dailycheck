<script setup lang="ts">
import type { PropType } from "vue";

const props = defineProps({
  sources: {
    type: Array as PropType<string[]>,
    required: true,
  },
  removable: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits<{
  (e: "remove", index: number): void;
}>();

function handleRemove(index: number): void {
  emit("remove", index);
}
</script>

<template>
  <div v-if="props.sources.length" class="image-list">
    <div v-for="(src, index) in props.sources" :key="src" class="image-item">
      <el-image :src="src" :preview-src-list="props.sources" :initial-index="index" fit="cover"
        class="detail-image clickable-image" lazy />
      <button v-if="props.removable" type="button" class="image-remove" @click.stop="handleRemove(index)">
        ×
      </button>
    </div>
  </div>
</template>

<style scoped>
.image-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.image-item {
  position: relative;
}

.detail-image {
  width: 80px;
  height: 80px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid #4b5563;
}

.clickable-image {
  cursor: pointer;
}

.image-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  border: none;
  background: rgba(15, 23, 42, 0.9);
  color: #f9fafb;
  font-size: 13px;
  line-height: 20px;
  text-align: center;
  cursor: pointer;
}
</style>
