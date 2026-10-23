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
    <!--
      注意：这里原本是 calc(100vh - var(--header-h) - 32px - 16px -120px)，
      「-120px」前面缺空格，calc 里 +/- 必须两侧留空格，否则整条声明非法被浏览器丢弃，
      侧栏列表高度根本没生效。顺带把 100vh 换成 --app-h、--header-h 换成 --header-total-h。
    -->
    <el-scrollbar
      wrap-style="height: calc(var(--app-h) - var(--header-total-h) - 32px - 16px - 120px);"
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
  background: var(--theme-action-bg);
  color: var(--theme-action-contrast);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.2s ease;

  &:hover {
    background: var(--theme-action-hover);
  }
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
  font-size: 13px;
}

.plan-dates {
  font-size: 11px;
  color: var(--text-muted);
}
</style>
