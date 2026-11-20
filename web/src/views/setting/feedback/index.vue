<script setup lang="ts">
import AdminFeedback from "@/features/setting/components/feedback/AdminFeedback.vue";
import UserFeedback from "@/features/setting/components/feedback/UserFeedback.vue";
import { useAuthStore } from "@/stores";

/**
 * 意见反馈子页外壳：只按角色切换两个视图，本身不持有表单 / 列表状态。
 *
 * 普通用户看到「意见反馈」（提交 + 我的反馈），管理员看到「查看意见」（列表 + 回复）；
 * 管理员视图里没有任何提交入口，普通用户视图里也没有管理入口 —— 角色隔离靠这里
 * 只挂载对应组件来实现，而不是靠 v-show 隐藏（隐藏的组件仍会发请求 / 存状态）。
 *
 * 路由守卫会在进入本页前 await initialAuth()，正常情况下 user 已有 role；
 * 这里再兜底一次：用户信息缺失时先显示骨架，避免把管理员短暂误判成普通用户。
 */
const authStore = useAuthStore();

/** 用户信息是否已就绪（role 可能为空，但 userId 存在就说明 /me 已返回） */
const ready = computed(() => Boolean(authStore.user));

onMounted(async () => {
  if (authStore.user) return;
  try {
    await authStore.initialAuth();
  } catch (err) {
    // 守卫已经加载失败过一次，这里不重复打扰用户：保持骨架并由页面自身兜底
    console.error("[setting/feedback] 加载当前用户信息失败", err);
  }
});
</script>

<template>
  <div v-if="!ready" class="setting-subpage">
    <div class="setting-card">
      <el-skeleton :rows="4" animated />
    </div>
  </div>
  <AdminFeedback v-else-if="authStore.isAdmin" />
  <UserFeedback v-else />
</template>
