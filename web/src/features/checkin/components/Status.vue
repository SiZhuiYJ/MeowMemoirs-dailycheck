<script setup lang="ts">
const props = defineProps<{
    slotStatus: 'missed' | 'done' | 'made' | 'pending' | 'future' | 'unknown';
}>();
</script>

<template>
    <div>
        <span v-if="slotStatus == 'missed'" class="dot missed">
            未打卡
        </span>
        <span v-else-if="slotStatus == 'done'" class="dot success">
            已打卡
        </span>
        <span v-else-if="slotStatus == 'made'" class="dot made">
            已补签
        </span>
        <span v-else-if="slotStatus == 'pending'" class="dot pending">
            进行中
        </span>
        <span v-else-if="slotStatus == 'future'" class="dot future">
            未开始
        </span>
        <span v-else class="dot unknown">未知</span>
    </div>
</template>

<style scoped lang="scss">
.dot {
    padding: 4px;
    border-radius: 8px;

    &.success {
        background: rgba(34, 197, 94, 0.2);
        color: #22c55e;
    }

    &.made {
        background: rgba(234, 179, 8, 0.2);
        color: #eab308;
    }

    &.missed {
        background: rgba(248, 113, 113, 0.2);
        color: #f87171;
    }

    &.future {
        background: rgba(129, 129, 129, 0.2);
        color: var(--text-color);
    }

    &.pending {
        background: var(--theme-color-soft);
        color: var(--theme-color-strong);
    }

    &.unknown {
        background: #94a3b8;
    }
}

// 夜间：提高状态标签的对比度（浅色底 + 亮色字在深色页面上会发灰）
html[data-theme="dark"] .dot {
    &.success {
        background: rgba(34, 197, 94, 0.16);
        color: #86efac;
    }

    &.made {
        background: rgba(234, 179, 8, 0.16);
        color: #fcd34d;
    }

    &.missed {
        background: rgba(248, 113, 113, 0.16);
        color: #fca5a5;
    }

    &.future {
        background: rgba(148, 163, 184, 0.16);
        color: var(--text-muted);
    }

    &.unknown {
        background: #334155;
        color: #e2e8f0;
    }
}
</style>
