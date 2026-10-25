<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { FileApi } from "@/features/file/api/index";
import { usePlanCalendar } from "@/features/plans/composables/usePlanCalendar";
import { useCheckinsStore } from "@/stores";
import type { CheckinDetail, CheckinStatus } from "@/features/checkin/types";
import type { TimeSlotDto } from "@/features/plans/types";
import { notifyError } from "@/utils/notification";
import CheckinDetailItem from "./CheckinDetailItem.vue";
import CheckinForm from "./CheckinForm.vue";
import Status from "./Status.vue";
import { isToday } from "@/utils/date";
const { toLocalDateOnlyString, getPlanTimeLength } = usePlanCalendar();

const props = defineProps<{
  modelValue: boolean;
  planId: number;
  date: Date;
  mode?: "default" | "timeSlot"; // 添加模式控制
  timeSlots?: TimeSlotDto[];
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "closed"): void;
  (e: "open-checkin"): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit("update:modelValue", val),
});

const detailLoading = ref<boolean>(false);
const detail = ref<CheckinDetail[] | null>(null);
const imageObjectUrls = ref<Map<string, string>>(new Map());
/**
 * 每次重新拉详情自增，作为条目的 key。
 * 打卡成功后同一时间段仍处于展开状态，元素不会重建 —— 而 `v-viewport` 的
 * `once` 已经把它取消观察了，新图片就不会再触发加载。换 key 强制重建条目，
 * 让「进入视口 → 加载图片」这条链路重新走一遍。
 */
const detailVersion = ref(0);

/**
 * 打卡图片的加载队列。
 *
 * 旧实现是「打开抽屉 → 把所有条目的所有图片串行下载完 → 才显示内容」：
 * 3 张图 × 5 个时间段就是 15 次串行请求，服务端只有 1MB/s 时要等十几秒，
 * 而且折叠着、根本看不到的时间段也在下载。
 *
 * 现在：详情元数据先渲染；图片按「条目进入视口」入队（折叠面板没展开就不下载），
 * 最多 2 张并发 —— 对 1MB/s 的下行来说，2 并发已经够快，再多只会互相抢占。
 */
const MAX_PARALLEL_IMAGE_LOADS = 2;
const imageQueue: string[] = [];
const requestedUrls = new Set<string>();
let activeImageLoads = 0;
/** 关闭 / 切换日期时自增，用来丢弃上一批还在路上的回包。 */
let imageLoadGeneration = 0;

function enqueueImages(urls: readonly string[] | undefined): void {
  if (!urls?.length) return;

  for (const url of urls) {
    if (!url || requestedUrls.has(url)) continue;
    requestedUrls.add(url);
    imageQueue.push(url);
  }
  pumpImageQueue();
}

function pumpImageQueue(): void {
  while (activeImageLoads < MAX_PARALLEL_IMAGE_LOADS && imageQueue.length > 0) {
    const url = imageQueue.shift();
    if (!url) break;

    activeImageLoads += 1;
    const generation = imageLoadGeneration;

    void FileApi.GetImage(url)
      .then((response) => {
        // 抽屉已关闭 / 切换了日期：结果直接丢弃，避免把旧图写回新列表。
        if (generation !== imageLoadGeneration) return;

        let blob: Blob;
        if (response.data instanceof ArrayBuffer) {
          blob = new Blob([response.data], { type: "image/webp" });
        } else if (response.data instanceof Blob) {
          blob = response.data;
        } else {
          blob = new Blob(
            [new Uint8Array(response.data as unknown as ArrayBuffer)],
            { type: "image/webp" },
          );
        }

        imageObjectUrls.value.set(url, URL.createObjectURL(blob));
      })
      .catch((error) => {
        console.error("Failed to load image:", url, error);
        if (generation === imageLoadGeneration) {
          // 失败也落一个空字符串占位，避免同一张图被反复重试。
          imageObjectUrls.value.set(url, "");
        }
      })
      .finally(() => {
        activeImageLoads = Math.max(0, activeImageLoads - 1);
        pumpImageQueue();
      });
  }
}

function resetImageCache(): void {
  imageLoadGeneration += 1;
  imageQueue.length = 0;
  requestedUrls.clear();

  for (const objectUrl of imageObjectUrls.value.values()) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
  imageObjectUrls.value.clear();
}

/** 条目进入视口后才加载它的图片（`once`：同一张图只触发一次）。 */
function viewportImages(imageUrls: readonly string[]) {
  return {
    handler: () => enqueueImages(imageUrls),
    options: { rootMargin: "240px" },
    once: true,
  };
}

/**
 * 获取打卡详情
 */
async function fetchDetail(): Promise<void> {
  if (!props.planId || !props.date) return;

  const iso = toLocalDateOnlyString(props.date);
  detailLoading.value = true;
  resetImageCache();
  try {
    const result = await useCheckinsStore().getCheckinDetail(props.planId, iso);
    detail.value = result;
    detailVersion.value += 1;

    // 非时间段模式只有一个条目、且一定在视口里：直接入队，
    // 不等 IntersectionObserver 的首帧回调。
    if (props.mode !== "timeSlot") {
      enqueueImages(result?.[0]?.imageUrls);
    }
  } catch {
    notifyError("加载打卡详情失败");
    visible.value = false;
  } finally {
    // 元数据到了就撤掉骨架屏；图片继续在后台补。
    detailLoading.value = false;
  }
}
/**
 * 关闭抽屉时清理数据
 */
function handleClosed(): void {
  resetImageCache();
  detail.value = null;
}



watch(
  () => visible.value,
  (open) => {
    if (!open) {
      handleClosed();
    } else {
      fetchDetail();
    }
  },
);

watch(
  () => [props.planId, props.date],
  () => {
    if (visible.value) {
      fetchDetail();
    }
  },
);

onBeforeUnmount(() => {
  handleClosed();
});

const findDetailById = (id: number): CheckinDetail | undefined => {
  return detail.value?.find((c) => c.timeSlotId === id);
};
/**
 * 获取打卡状态
 */
const slotStatuses = (slot: TimeSlotDto): CheckinStatus => {
  const now = new Date();
  const todayStr = toLocalDateOnlyString(now);
  const selectedStr = toLocalDateOnlyString(props.date);
  const isPast = selectedStr < todayStr;
  const isFuture = selectedStr > todayStr;

  // Current time in HH:mm:ss
  const nowTimeStr = now.toTimeString().split(" ")[0] as string;

  let status: CheckinStatus = "future";
  const checkin = findDetailById(slot.id);
  if (checkin) {
    if (checkin.status == 1) status = "done";
    else status = "made";
  } else if (isFuture) {
    status = "future";
  } else if (isPast) {
    status = "missed";
  } else {
    // Today
    if (nowTimeStr < slot.startTime) {
      status = "future";
    } else if (nowTimeStr > slot.endTime) {
      status = "missed";
    } else {
      status = "pending";
    }
  }
  return status;
};
</script>

<template>
  <el-drawer v-model="visible" direction="btt" size="auto" @closed="handleClosed">
    <template #header="{ titleId, titleClass }">
      <h1 :id="titleId" :class="titleClass">
        打卡详情
        {{ " · " + toLocalDateOnlyString(props.date) }}
        <template v-if="props.mode == 'default' && !detail?.length">
          {{ isToday(props.date) ? " · 打卡" : " · 补卡" }}
        </template>
      </h1>
    </template>
    <!-- 用 --app-h（键盘/地址栏感知）而不是 100vh，横屏手机上抽屉内容才不会被切掉 -->
    <el-scrollbar wrap-style="max-height: calc(var(--app-h) - 80px);" view-class="drawer-body">
      <el-skeleton v-if="detailLoading" class="detail" :rows="getPlanTimeLength(props.planId)" animated />
      <div v-else-if="props.mode == 'default'" class="detail">
        <CheckinForm v-if="!detail || !detail[0]" :plan-id="props.planId" :date="props.date" @success="fetchDetail" />
        <CheckinDetailItem v-else :key="`detail-${detailVersion}`" :checkin-detail="detail[0]"
          :image-object-urls="imageObjectUrls" v-viewport="viewportImages(detail[0].imageUrls)" />
      </div>
      <el-collapse v-else-if="props.mode == 'timeSlot'" expand-icon-position="left">
        <el-collapse-item v-for="(item, index) in timeSlots" :key="index" :name="index"
          :disabled="slotStatuses(item) == 'future'">
          <template #title>
            <div class="time-slot-container">
              <span class="time-slot-tag">
                {{ item.slotName }} · {{ item.startTime }}-
                {{ item.endTime }}
              </span>
              <Status :slot-status="slotStatuses(item)" />
            </div>
          </template>
          <CheckinDetailItem v-if="findDetailById(item.id)" :key="`slot-${item.id}-${detailVersion}`"
            :checkin-detail="findDetailById(item.id)!"
            :image-object-urls="imageObjectUrls" noStatus
            v-viewport="viewportImages(findDetailById(item.id)!.imageUrls)" />
          <CheckinForm v-else :plan-id="props.planId" :date="props.date" :time-slot-id="item.id"
            @success="fetchDetail" />
        </el-collapse-item>
      </el-collapse>
    </el-scrollbar>
  </el-drawer>
</template>

<style scoped lang="scss">
:deep(.drawer-body) {
  padding: 12px;
}

.time-slot-container {
  width: 100%;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}
</style>
