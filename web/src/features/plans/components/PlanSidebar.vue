<script setup lang="ts">
import type { PropType } from "vue";
import { storeToRefs } from "pinia";
import { usePlansStore } from "@/stores";
const { loading } = storeToRefs(usePlansStore());

interface PlanItem {
  id: number;
  title: string;
  startDate: string;
  endDate: string | null;
}

const props = defineProps({
  items: {
    type: Array as PropType<PlanItem[]>,
    required: true,
  },
});
const selectedId = defineModel<number | null>("selectedId");
const emit = defineEmits<{
  (e: "create"): void;
}>();

function handleSelect(id: number): void {
  selectedId.value = id;
}

function handleCreate(): void {
  emit("create");
}
</script>

<template>
  <section class="sidebar">
    <div class="sidebar-header">
      <h2>我的计划</h2>
      <button type="button" class="create" @click="handleCreate">
        ＋ 新建
      </button>
    </div>
    <el-scrollbar
      wrap-style="height: calc(100vh - var(--header-h) - 32px - 16px -120px);"
    >
      <el-skeleton v-if="loading" class="detail" :rows="5" animated />
      <ul v-else class="plan-list">
        <li
          v-for="plan in props.items"
          :key="plan.id"
          :class="['plan-item', plan.id === selectedId ? 'active' : '', 'ink']"
          @click="handleSelect(plan.id)"
        >
          <div class="plan-title">{{ plan.title }}</div>
          <div class="plan-dates">
            {{ plan.startDate }}
            <span v-if="plan.endDate">~ {{ plan.endDate }}</span>
          </div>
        </li>
      </ul>
    </el-scrollbar>
  </section>
</template>

<style scoped lang="scss">
.sidebar {
  border-right: 1px solid var(--border-color);
  padding: 16px 0 0;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  padding: 0 16px;
}

.create {
  border-radius: 999px;
  border: none;
  padding: 4px 10px;
  background: var(--accent-alt);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}

.plan-list {
  list-style: none;
  padding: 0 16px;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.plan-item {
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px dashed rgba(0, 0, 0, 0);
}

.ink {
  --bgc-color: rgba(34, 197, 94);

  &::after {
    --bgc-color: rgba(34, 197, 94);
  }
}

.plan-item.active {
  // background: rgba(34, 197, 94, 0.15);
  border: 1px dashed var(--bgc-color);
}

.plan-title {
  font-size: 14px;
}

.plan-dates {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
