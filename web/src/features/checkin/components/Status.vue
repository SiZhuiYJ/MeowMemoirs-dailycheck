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
        color: #353535;
    }

    &.pending {
        background: rgba(122, 175, 255, 0.2);
        color: #3b82f6;
    }

    &.unknown {
        background: #94a3b8;
    }
}
</style>
