<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { FileApi } from "@/features/file/api/index";
import { useCheckinsStore, usePlansStore } from "@/stores";
import ImagePreviewList from "@/features/file/components/ImagePreviewList.vue";
import { toLocalDateOnlyString } from "@/utils/date";
import {
  notifySuccess,
  notifyError,
  notifyWarning,
} from "@/utils/notification";
import { convertToWebP } from "@/utils/convertToWebP";

const props = defineProps<{
  planId?: number;
  date?: Date;
  timeSlotId?: number;
}>();

const emit = defineEmits<{
  (e: "success"): void;
  (e: "closed"): void;
}>();

const checkinsStore = useCheckinsStore();
const plansStore = usePlansStore();

const note = ref("");
const images = ref<File[]>([]);
const previewSrcs = ref<string[]>([]);
const loading = ref(false);

const currentPlan = computed(() => {
  return plansStore.PlansItems.find((p) => p.id === props.planId);
});

function clearPreviews(): void {
  for (const src of previewSrcs.value) {
    URL.revokeObjectURL(src);
  }
  previewSrcs.value = [];
}

function resetForm(): void {
  note.value = "";
  images.value = [];
  clearPreviews();
}

async function uploadImages(): Promise<string[]> {
  const urls: string[] = [];
  for (const file of images.value) {
    // 转换为 WebP 格式。
    // 必须带上尺寸上限：打卡照片是手机原图（4000px+），全尺寸建画布 + 全质量编码
    // 会让移动端渲染进程 OOM（表现为「选完图片页面自己刷新了」）。
    const webpFile = await convertToWebP(file, {
      quality: 0.9,
      maxWidth: 1920,
      maxHeight: 1920,
      output: 'file',
      fileName: file.name.replace(/\.[^.]+$/, '.webp')
    }) as File;

    const formData = new FormData();
    formData.append("file", webpFile);
    const res = await FileApi.UploadImage(formData);
    urls.push(res.data.url);

    // 多图时每张之间让出主线程，避免整页卡死
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return urls;
}

function handleFilesChange(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files) {
    const newFiles = Array.from(input.files);
    if (images.value.length + newFiles.length > 3) {
      notifyWarning("最多只能上传三张图片");
      return;
    }
    images.value.push(...newFiles);
    newFiles.forEach((file) => {
      previewSrcs.value.push(URL.createObjectURL(file));
    });
  }
  input.value = "";
}

function removeImage(index: number) {
  images.value.splice(index, 1);
  const src = previewSrcs.value[index];
  if (src) URL.revokeObjectURL(src);
  previewSrcs.value.splice(index, 1);
}

async function handleSubmit(): Promise<void> {
  if (!props.planId || !props.date) return;
  if (images.value.length < 1) {
    notifyWarning("请至少上传一张图片");
    return;
  }
  if (images.value.length > 3) {
    notifyWarning("最多只能上传三张图片");
    return;
  }

  // Check time slot requirement
  if (
    currentPlan.value?.timeSlots &&
    currentPlan.value.timeSlots.length > 0 &&
    !props.timeSlotId
  ) {
    notifyWarning("请选择打卡时间段");
    return;
  }

  loading.value = true;
  try {
    const urls = await uploadImages();

    const todayDate = new Date();
    const target = props.date;
    const todayOnly = new Date(
      todayDate.getFullYear(),
      todayDate.getMonth(),
      todayDate.getDate(),
    );
    const targetOnly = new Date(
      target.getFullYear(),
      target.getMonth(),
      target.getDate(),
    );

    const payload = {
      planId: props.planId,
      imageUrls: urls,
      note: note.value || undefined,
      timeSlotId: props.timeSlotId || undefined,
    };

    if (targetOnly.getTime() === todayOnly.getTime()) {
      // Check if force retro needed for today
      let forceRetro = false;
      if (props.timeSlotId && currentPlan.value?.timeSlots) {
        const slot = currentPlan.value.timeSlots.find(
          (s) => s.id === props.timeSlotId,
        );
        if (slot) {
          const now = new Date();
          const nowTimeStr = now.toTimeString().split(" ")[0] || "";
          if (nowTimeStr > slot.endTime) {
            forceRetro = true;
          }
        }
      }

      if (forceRetro) {
        const isoDate = toLocalDateOnlyString(target);
        await checkinsStore.retroCheckin({ ...payload, date: isoDate });
        notifySuccess("补签成功");
      } else {
        await checkinsStore.dailyCheckin(payload);
        notifySuccess("今日打卡成功");
      }
    } else if (targetOnly.getTime() < todayOnly.getTime()) {
      const isoDate = toLocalDateOnlyString(target);
      await checkinsStore.retroCheckin({ ...payload, date: isoDate });
      notifySuccess("补签成功");
    } else {
      notifyError("仅支持今日打卡或过去日期补签");
      return;
    }

    resetForm();
    emit("success");
  } catch {
    notifyError("打卡失败，请稍后重试");
  } finally {
    loading.value = false;
  }
}

function handleClosed(): void {
  resetForm();
}

watch(
  () => [props.date],
  ([date, open]) => {
    if (open && date) {
      resetForm();
    }
  },
);

onBeforeUnmount(() => {
  clearPreviews();
});
// 暴露出组件handleClosed()
defineExpose({
  handleClosed,
});
</script>

<template>
  <div class="drawer-form">
    <label class="field">
      <span class="title">备注</span>
      <textarea v-model="note" rows="3" />
    </label>
    <div class="field">
      <span class="title">上传图片（至少 1 张，最多 3 张）</span>
      <span class="image-list">
        <ImagePreviewList :sources="previewSrcs" removable @remove="removeImage" />
        <label class="upload-button" aria-label="上传文件按钮">
          <input type="file" id="realFileInput" name="uploadFile" aria-label="选择文件" accept="image/*" multiple
            @change="handleFilesChange" />
        </label>
      </span>
    </div>
    <button type="button" class="primary" :disabled="loading" @click="handleSubmit">
      {{ loading ? "提交中..." : "提交打卡" }}
    </button>
  </div>
</template>

<style scoped lang="scss">
.drawer-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;

  .title {
    color: var(--text-muted);
  }

  textarea {
    border-radius: 8px;
    border: 1px solid var(--border-color);
    padding: 8px 10px;
    font-size: 13px;
    background: var(--bg-elevated);
    color: var(--text-color);
  }
}

.image-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.primary {
  margin-top: 4px;
  border-radius: 8px;
  border: none;
  padding: 8px 0;
  background: var(--theme-action-bg);
  color: var(--theme-action-contrast);
  cursor: pointer;
  transition: background-color 0.2s ease;

  &:hover {
    background: var(--theme-action-hover);
  }
}

</style>
