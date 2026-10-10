// 导入 createPinia 函数用于创建 Pinia 实例
import { createPinia } from "pinia";
// 导入 persist 插件用于持久化存储 Pinia 状态
import persist from "pinia-plugin-persistedstate";
// 创建 Pinia 实例
const pinia = createPinia();
// 使用 persist 插件
pinia.use(persist);

// 导出 Pinia 实例
export default pinia;

// 导出 auth 模块
export * from "@/features/auth/stores";
// 导出 checkin 模块
export * from "@/features/checkin/stores";
// 导出 plans 模块
export * from "@/features/plans/stores";