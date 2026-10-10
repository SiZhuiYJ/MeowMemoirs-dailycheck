import {
  createRouter,
  createWebHashHistory,
  createWebHistory,
} from "vue-router";
import { staticRouter, errorRouter } from "@/routers/modules/staticRouter";
import nprogress from "@/utils/nprogress";
import type { RouteLocationNormalized, NavigationGuardNext } from "vue-router";
import { useAuthStore } from "@/stores";
import { LOGIN_URL } from "@/config";
import { notifyWarning } from "@/utils/notification";

// .env配置文件读取
const mode = import.meta.env.VITE_ROUTER_MODE;

// 路由访问两种模式：带#号的哈希模式，正常路径的web模式。
const routerMode: any = {
  hash: () => createWebHashHistory(),
  history: () => createWebHistory(),
};

// 创建路由器对象
const router = createRouter({
  // 路由模式hash或者默认不带#
  history: routerMode[mode](),
  routes: [...staticRouter, ...errorRouter],
  strict: false,
  // 滚动行为
  scrollBehavior() {
    return {
      left: 0,
      top: 0,
    };
  },
});

/**
 * @description 前置路由
 * */
router.beforeEach(
  async (
    to: RouteLocationNormalized,
    from: RouteLocationNormalized,
    next: NavigationGuardNext,
  ) => {
    console.log("前置守卫", router.getRoutes(), to, from);

    // 1、NProgress 开始
    nprogress.start();

    // 、判断是否有 Token，没有重定向到 login 页面。
    if (!useAuthStore().isAuthenticated && to.path !== LOGIN_URL) {
      notifyWarning("未登录，请登录");
      return next({ path: LOGIN_URL, replace: true });
    }
    // 、判断是访问登陆页，有Token访问当前页面，token过期访问接口，axios封装则自动跳转登录页面，没有Token重置路由到登陆页。
    if (to.path.toLocaleLowerCase() === LOGIN_URL) {
      // 有Token访问当前页面
      console.log(useAuthStore().isAuthenticated);
      if (useAuthStore().isAuthenticated) {
        return next(from.fullPath);
      } else {
        // 没有Token重置路由到登陆页。
        resetRouter();
        return next();
      }
    }
    // 、判断是否有用户信息
    if (!useAuthStore().user) {
      try {
        await useAuthStore().initialAuth();
      } catch (error) {
        console.error("初始化用户信息失败", error);
      }
    }

    next();
  },
);

/**
 * @description 重置路由
 */
export const resetRouter = () => {
  console.log("重置路由");
};

/**
 * @description 路由跳转错误
 */
router.onError((error) => {
  // 结束全屏动画
  nprogress.done();
  console.warn("路由错误", error.message);
});

/**
 * @description 后置路由
 */
// @ts-ignore
router.afterEach(
  (to: RouteLocationNormalized, from: RouteLocationNormalized) => {
    console.log("后置守卫", to, from);
    // 结束全屏动画
    nprogress.done();
  },
);

export default router;
