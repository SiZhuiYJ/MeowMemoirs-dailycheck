// @/features/Curriculum/useClass.ts
import { ref } from "vue";
import { ClassApi } from "@/libs/api/class/index";
import type { Class } from "@/libs/api/class/type";
import { useAuthStore } from "@/stores/auth";

export default function useClass() {
  // 所有课程列表
  const classes = ref<Class[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  async function initializeData() {
    isLoading.value = true;
    error.value = null;

    try {
      const authStore = useAuthStore();
      const userId = authStore.user?.userId;

      // const { data } = await ClassApi.PostClassesByID(7);
      const { data } = await ClassApi.PostClassesByID(userId as number);

      classes.value = data.map((item) => ({
        id: item.id,
        name: item.className,
        location: item.location,
        dayOfWeek: item.dayOfWeek,
        week: JSON.parse(item.weekList),
        number: JSON.parse(item.sessionList),
        teacher: item.teacher,
        color: item.color,
        remark: item.remark,
      }));
    } catch (err: any) {
      // 如果是 401 错误，由 http 拦截器处理重定向
      if (err?.statusCode === 401) return;

      classes.value = [];
      error.value = err instanceof Error ? err.message : "课表获取失败";
      console.error("课表获取失败:", err);

      // 加载示例数据用于演示
      loadExampleData();
    } finally {
      isLoading.value = false;
    }
  }

  function loadExampleData() {
    // 示例课程数据（当 API 不可用时使用）
    classes.value = [];
    console.log("已加载示例课表数据");
  }

  function getClassById(id: number): Class | undefined {
    return classes.value.find((course) => course.id === id);
  }

  // 获取周次某天某节课的课程
  function getClass(
    week: number,
    dayOfWeek: number,
    number: number,
  ): Class | undefined {
    return classes.value.find(
      (item) =>
        item.week.includes(week) &&
        item.dayOfWeek === dayOfWeek &&
        item.number.includes(number),
    );
  }

  return {
    classes, // 所有课程列表
    isLoading,
    error,
    initializeData, // 初始化数据
    getClassById,
    getClass, // 获取周次某天某节课的课程
  };
}
