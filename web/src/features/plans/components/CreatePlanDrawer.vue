<script setup lang="ts">
import { ref, watch, type PropType } from "vue";
import { ElMessageBox } from "element-plus";
import { usePlansStore } from "@/stores";
import type { PlanSummary, TimeSlotDto } from "@/features/plans/types";
import { notifySuccess, notifyWarning } from "@/utils/notification";

const props = defineProps({
  editPlan: {
    type: Object as PropType<PlanSummary | null>,
    default: null,
  },
});

const emit = defineEmits<{
  (e: "created", id: number): void;
  (e: "updated", id: number): void;
  (e: "deleted", id: number): void;
}>();

const model = defineModel<boolean>();

const plansStore = usePlansStore();

const title = ref("");
const description = ref("");
const startDate = ref<string | null>(null);
const endDate = ref<string | null>(null);
const isActive = ref(true);

const enableTimeSlots = ref(false);
const timeSlots = ref<TimeSlotDto[]>([]);

function resetForm(): void {
  title.value = "";
  description.value = "";
  startDate.value = null;
  endDate.value = null;
  isActive.value = true;
  enableTimeSlots.value = false;
  timeSlots.value = [];
}

watch(
  () => props.editPlan,
  (newVal) => {
    if (newVal) {
      title.value = newVal.title;
      description.value = newVal.description ?? "";
      startDate.value = newVal.startDate;
      endDate.value = newVal.endDate;
      isActive.value = newVal.isActive;
      if (newVal.timeSlots && newVal.timeSlots.length > 0) {
        enableTimeSlots.value = true;
        // Deep copy to avoid mutating store state directly
        timeSlots.value = JSON.parse(JSON.stringify(newVal.timeSlots));
      } else {
        enableTimeSlots.value = false;
        timeSlots.value = [];
      }
    } else {
      resetForm();
    }
  },
  { immediate: true },
);

async function handleSubmit(): Promise<void> {
  if (!title.value.trim()) {
    notifyWarning("请输入计划标题");
    return;
  }

  if (
    startDate.value &&
    endDate.value &&
    new Date(endDate.value) < new Date(startDate.value)
  ) {
    notifyWarning("结束日期不能早于开始日期");
    return;
  }

  // Time slots validation
  if (enableTimeSlots.value) {
    if (timeSlots.value.length === 0) {
      notifyWarning("请至少添加一个打卡时间段");
      return;
    }
    for (const slot of timeSlots.value) {
      if (!slot.startTime || !slot.endTime) {
        notifyWarning("请填写完整的时间段信息");
        return;
      }
      if (slot.startTime >= slot.endTime) {
        notifyWarning(`时间段 ${slot.slotName || ""} 开始时间必须早于结束时间`);
        return;
      }
    }
    // Check overlaps
    const sorted: TimeSlotDto[] = [...timeSlots.value].sort((a, b) =>
      a.startTime.localeCompare(b.startTime),
    );
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];
      if (current && next && current.endTime > next.startTime) {
        notifyWarning("时间段存在重叠，请检查设置");
        return;
      }
    }
  }

  const payloadTimeSlots = enableTimeSlots.value
    ? timeSlots.value.map((ts, index) => ({
        ...ts,
        orderNum: index + 1,
        isActive: true,
      }))
    : undefined;

  if (props.editPlan) {
    await plansStore.updatePlan({
      id: props.editPlan.id,
      title: title.value.trim(),
      description: description.value || null,
      startDate: startDate.value ?? null,
      endDate: endDate.value ?? null,
      isActive: isActive.value,
      timeSlots: payloadTimeSlots,
    });
    notifySuccess("修改计划成功");
    emit("updated", props.editPlan.id);
  } else {
    const created = await plansStore.createPlan({
      title: title.value.trim(),
      description: description.value || null,
      startDate: startDate.value ?? null,
      endDate: endDate.value ?? null,
      timeSlots: payloadTimeSlots,
    });
    notifySuccess("创建计划成功");
    emit("created", created.id);
  }

  model.value = false;
}

async function handleDelete(): Promise<void> {
  if (!props.editPlan) return;
  try {
    await ElMessageBox.confirm(
      "确定要删除这个计划吗？此操作无法撤销。",
      "删除确认",
      {
        confirmButtonText: "删除",
        cancelButtonText: "取消",
        type: "warning",
      },
    );
    await plansStore.deletePlan(props.editPlan.id);
    notifySuccess("删除计划成功");
    emit("deleted", props.editPlan.id);
    model.value = false;
  } catch {
    // Cancelled
  }
}

function handleClosed(): void {
  resetForm();
}

function addTimeSlot() {
  timeSlots.value.push({
    id: 0,
    startTime: "09:00:00",
    endTime: "10:00:00",
    slotName: "",
    isActive: true,
  });
}

function removeTimeSlot(index: number) {
  timeSlots.value.splice(index, 1);
}
</script>

<template>
  <el-drawer v-model="model" direction="btt" size="auto" @closed="handleClosed">
    <template #header="{ titleId, titleClass }">
      <h1 :id="titleId" :class="titleClass">
        {{ props.editPlan ? "修改打卡计划" : "创建打卡计划" }}
      </h1>
    </template>
    <el-scrollbar
      wrap-style="max-height: calc(var(--app-h) - 80px);"
      view-class="drawer-body"
    >
      <label class="field">
        <span>计划标题</span>
        <input v-model="title" type="text" />
      </label>
      <label class="field">
        <span>计划描述</span>
        <textarea v-model="description" rows="3" />
      </label>
      <label class="field">
        <span>开始日期（可选，默认今天）</span>
        <el-date-picker
          v-model="startDate"
          type="date"
          placeholder="选择开始日期"
          format="YYYY-MM-DD"
          value-format="YYYY-MM-DD"
        />
      </label>
      <label class="field">
        <span>结束日期（可选）</span>
        <el-date-picker
          v-model="endDate"
          type="date"
          placeholder="选择结束日期"
          format="YYYY-MM-DD"
          value-format="YYYY-MM-DD"
        />
      </label>
      <label class="field-row" v-if="!props.editPlan">
        <span>开启分时段打卡</span>
        <el-switch v-model="enableTimeSlots" />
      </label>

      <div v-if="enableTimeSlots" class="time-slots-container">
        <div
          v-for="(slot, index) in timeSlots"
          :key="index"
          class="time-slot-item"
        >
          <div class="slot-header">
            <span>时间段 {{ index + 1 }}</span>
            <button class="icon-btn danger" @click="removeTimeSlot(index)">
              删除
            </button>
          </div>
          <div class="slot-row">
            <input
              v-model="slot.slotName"
              placeholder="名称 (如: 早晨)"
              class="slot-name-input"
            />
          </div>
          <div class="slot-row time-range">
            <el-time-picker
              v-model="slot.startTime"
              placeholder="开始时间"
              value-format="HH:mm:ss"
              style="width: 100%"
            />
            <span class="separator">至</span>
            <el-time-picker
              v-model="slot.endTime"
              placeholder="结束时间"
              value-format="HH:mm:ss"
              style="width: 100%"
            />
          </div>
        </div>
        <button type="button" class="secondary" @click="addTimeSlot">
          + 添加打卡时间段
        </button>
      </div>

      <label v-if="props.editPlan" class="field-row">
        <span>是否启用</span>
        <el-switch v-model="isActive" />
      </label>

      <div class="actions">
        <button type="button" class="primary" @click="handleSubmit">
          {{ props.editPlan ? "保存修改" : "创建" }}
        </button>
        <button
          v-if="props.editPlan"
          type="button"
          class="danger"
          @click="handleDelete"
        >
          删除计划
        </button>
      </div>
    </el-scrollbar>
  </el-drawer>
</template>

<style scoped>
:deep(.drawer-body) {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}

.field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
}

.field span,
.field-row span {
  color: var(--text-muted);
}

.time-slots-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  background-color: var(--bg-secondary);
  border-radius: 8px;
}

.time-slot-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background-color: var(--bg-primary);
  border-radius: 6px;
  border: 1px solid var(--border-color);
}

.slot-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
}

.slot-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.time-range {
  display: flex;
  align-items: center;
}

.separator {
  color: var(--text-muted);
  font-size: 11px;
  padding: 0 4px;
}

.slot-name-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background-color: var(--bg-secondary);
  color: var(--text-primary);
}

.icon-btn.danger {
  padding: 2px 8px;
  font-size: 11px;
  background: none;
  color: var(--danger-color);
  border: 1px solid var(--danger-color);
}

.secondary {
  background-color: transparent;
  border: 1px dashed var(--border-color);
  color: var(--text-secondary);
}

input,
textarea {
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background-color: var(--bg-primary);
  color: var(--text-primary);
}

input:focus,
textarea:focus {
  border-color: var(--accent-color);
  outline: none;
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

button {
  flex: 1;
  padding: 10px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: opacity 0.2s;
}

button:active {
  opacity: 0.8;
}

button.primary {
  background-color: var(--accent-color);
  color: white;
}

button.danger {
  background-color: #fee2e2;
  color: #ef4444;
}
</style>
