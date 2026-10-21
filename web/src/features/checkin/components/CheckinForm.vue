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
  background: var(--accent-alt);
  cursor: pointer;
}

.upload-button {
  position: relative;
  /* 让内部的 absolute input 可以填满 */
  display: block;
  width: 80px;
  /* 正方形尺寸，可自由调整 */
  height: 80px;
  border-radius: 8px;
  /* 圆角正方形，够圆润 */
  background-color: #eef2ff;
  /* 柔和的底色（ indigo 极浅色） */
  border: 1px solid #4b5563;
  /* 使用纯CSS渐变绘制“加号”：两个垂直的矩形背景，居中，不重复 */
  background-image:
    linear-gradient(var(--text-muted), var(--text-muted)),
    /* 水平条（横） */
    linear-gradient(var(--text-muted), var(--text-muted));
  /* 垂直条（竖） */
  background-repeat: no-repeat;
  background-position: center;
  /* 加号尺寸：横条 48x8，竖条 8x48，在120x120里显得醒目又优雅 */
  background-size:
    32px 2px,
    2px 32px;

  /* 柔和阴影，增加立体感 */
  box-shadow: 0 8px 16px -6px rgba(79, 70, 229, 0.4);

  /* 过渡效果，用于焦点或悬停时的反馈 */
  transition:
    background-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.1s ease;
  cursor: pointer;
  /* 提示可点击 */


  /* 当按钮被点击（按下）时轻微的缩放感 */
  &:active {
    transform: scale(0.97);
  }

  /* 当内部隐藏的input获得焦点时，给按钮加上发光外圈 — 键盘友好 */
  &:focus-within {
    outline: none;
    box-shadow:
      0 0 0 2px rgba(79, 70, 229, 0.4),
      0 4px 16px -6px #4f46e5;
    background-color: #e0e7ff;
    /* 稍微深一点的底色，反馈焦点 */
  }

  /* 鼠标悬停时，底色稍微加深，加号颜色也可以微调 —— 这里保留加号颜色不变，改变背景色 */
  &:hover {
    background-color: #d9e0fc;
    /* 稍微明显的悬停色 */
  }

  /* 真正的 input[type=file] 被透明地覆盖在整个按钮上，保证点击区域精准，同时隐藏原生样式 */
  input[type="file"] {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    /* 完全透明，但依然可点击、可聚焦 */
    cursor: pointer;
    /* 明确指针形状 */
    z-index: 2;
    /* 确保它在上层接收点击（背景在下面） */
    margin: 0;
    /* 移除默认边距 */
    padding: 0;
    border: none;
    /* 以下为兼容屏幕阅读器，保留元素尺寸且可聚焦 */
    font-size: 0;
    /* 避免极少数浏览器出现文本节点 */
  }
}
</style>
