import type { RouteRecordRaw } from "vue-router";
import { HOME_URL, LOGIN_URL } from "@/config/index";
import main from "@/views/main/index.vue";

/**
 * staticRouter[静态路由]
 */
export const staticRouter: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: HOME_URL,
  },
  /** 主控台 RouteRecordRaw[]*/
  {
    path: "/main",
    name: "main",
    component: main,
    redirect: HOME_URL,
    children: [
      {
        path: HOME_URL, // [唯一]
        component: () => import("@/views/main/home/index.vue"),
        meta: {
          title: "首页", // 标题
          enName: "Master Station", // 英文名称
          icon: "HomeFilled", // 图标 HomeFilled
          isHide: "1", // 代表路由在菜单中是否隐藏，是否隐藏[0隐藏，1显示]
          isLink: "", // 是否外链[有值则是外链]
          isKeepAlive: "0", // 是否缓存路由数据[0是，1否]
          isFull: "1", // 是否缓存全屏[0是，1否]
          isAffix: "0", // 是否缓存固定路由[0是，1否]
        },
      },
    ],
  },
  {
    path: "/setting", // [唯一]
    name: "setting",
    redirect: "/setting/profile",
    component: () => import("@/views/setting/index.vue"),
    children: [
      {
        path: "/setting/profile", // [唯一]
        component: () => import("@/views/setting/profile/index.vue"),
        meta: {
          title: "个人资料",
          enName: "Profile",
          icon: "User",
          isHide: "1",
          isLink: "",
          isKeepAlive: "0",
          isFull: "1",
        },
      },
      {
        path: "/setting/avatar", // [唯一]
        component: () => import("@/views/setting/avatar/index.vue"),
        meta: {
          title: "头像修改",
          enName: "Avatar",
          icon: "User",
          isHide: "1",
          isLink: "",
          isKeepAlive: "0",
          isFull: "1",
        },
      },
      {
        path: "/setting/account", // [唯一]
        component: () => import("@/views/setting/account/index.vue"),
        meta: {
          title: "账号修改",
          enName: "Account",
          icon: "Setting",
          isHide: "1",
          isLink: "",
          isKeepAlive: "0",
          isFull: "1",
        },
      },
      {
        path: "/setting/password", // [唯一]
        component: () => import("@/views/setting/password/index.vue"),
        meta: {
          title: "密码修改",
          enName: "Password",
          icon: "Lock",
          isHide: "1",
          isLink: "",
          isKeepAlive: "0",
          isFull: "1",
        },
      },
      {
        path: "/setting/deactivate", // [唯一]
        component: () => import("@/views/setting/deactivate/index.vue"),
        meta: {
          title: "注销账号",
          enName: "Deactivate",
          icon: "Delete",
          isHide: "1",
          isLink: "",
          isKeepAlive: "0",
          isFull: "1",
        },
      },
      {
        path: "/setting/bind", // [唯一]
        component: () => import("@/views/setting/bind/index.vue"),
        meta: {
          title: "第三方绑定",
          enName: "ThirdParty",
          icon: "Link",
          isHide: "1",
          isLink: "",
          isKeepAlive: "0",
          isFull: "1",
        },
      },
    ],
  },
  {
    path: "/chat",
    name: "chat",
    component: () => import("@/views/chat/index.vue"),
    meta: {
      title: "传书", // 标题
      enName: "chat", // 英文名称
      icon: "HomeFilled", // 图标 HomeFilled
      isHide: "1", // 代表路由在菜单中是否隐藏，是否隐藏[0隐藏，1显示]
      isLink: "", // 是否外链[有值则是外链]
      isKeepAlive: "0", // 是否缓存路由数据[0是，1否]
      isFull: "1", // 是否缓存全屏[0是，1否]
      isAffix: "0", // 是否缓存固定路由[0是，1否]
    },
  },
  {
    path: "/gsap",
    name: "gsap",
    component: () => import("@/views/gsap/index.vue"),
    meta: {
      title: "gsap动画", // 标题
      enName: "gsap", // 英文名称
      icon: "HomeFilled", // 图标 HomeFilled
      isHide: "1", // 代表路由在菜单中是否隐藏，是否隐藏[0隐藏，1显示]
      isLink: "", // 是否外链[有值则是外链]
      isKeepAlive: "0", // 是否缓存路由数据[0是，1否]
      isFull: "1", // 是否缓存全屏[0是，1否]
      isAffix: "0", // 是否缓存固定路由[0是，1否]
    },
  },
  {
    path: "/demo", // [唯一]
    name: "demo",
    redirect: "/demo/video-converter",
    // component: () => import("@/views/demo/video-converter.vue"),
    children: [
      {
        path: "/demo/video-converter",
        name: "videoConverter",
        component: () => import("@/views/demo/video-converter.vue"),
        meta: {
          title: "视频转WebM", // 标题
          enName: "Video Converter", // 英文名称
          icon: "VideoCamera", // 图标
          isHide: "1", // 代表路由在菜单中是否隐藏，是否隐藏[0隐藏，1显示]
          isLink: "", // 是否外链[有值则是外链]
          isKeepAlive: "0", // 是否缓存路由数据[0是，1否]
          isFull: "1", // 是否缓存全屏[0是，1否]
          isAffix: "0", // 是否缓存固定路由[0是，1否]
        },
      },
      {
        path: "/demo/video-converter-pro",
        name: "videoConverter",
        component: () => import("@/views/demo/video-converter-pro.vue"),
        meta: {
          title: "视频转WebM", // 标题
          enName: "Video Converter", // 英文名称
          icon: "VideoCamera", // 图标
          isHide: "1", // 代表路由在菜单中是否隐藏，是否隐藏[0隐藏，1显示]
          isLink: "", // 是否外链[有值则是外链]
          isKeepAlive: "0", // 是否缓存路由数据[0是，1否]
          isFull: "1", // 是否缓存全屏[0是，1否]
          isAffix: "0", // 是否缓存固定路由[0是，1否]
        },
      },
      {
        path: "/demo/video-converter-plus",
        name: "videoConverter",
        component: () => import("@/views/demo/video-converter-plus.vue"),
        meta: {
          title: "视频转WebM", // 标题
          enName: "Video Converter", // 英文名称
          icon: "VideoCamera", // 图标
          isHide: "1", // 代表路由在菜单中是否隐藏，是否隐藏[0隐藏，1显示]
          isLink: "", // 是否外链[有值则是外链]
          isKeepAlive: "0", // 是否缓存路由数据[0是，1否]
          isFull: "1", // 是否缓存全屏[0是，1否]
          isAffix: "0", // 是否缓存固定路由[0是，1否]
        },
      },
      {
        path: "/demo/file-preview",
        name: "filePreviewDemo",
        component: () => import("@/views/demo/file-preview.vue"),
        meta: {
          title: "文件预览演示", // 标题
          enName: "File Preview Demo", // 英文名称
          icon: "View", // 图标
          isHide: "1", // 代表路由在菜单中是否隐藏，是否隐藏[0隐藏，1显示]
          isLink: "", // 是否外链[有值则是外链]
          isKeepAlive: "0", // 是否缓存路由数据[0是，1否]
          isFull: "1", // 是否缓存全屏[0是，1否]
          isAffix: "0", // 是否缓存固定路由[0是，1否]
        },
      },
    ]
  },
  {
    path: LOGIN_URL,
    name: "login",
    component: () => import("@/views/auth/index.vue"),
    meta: {
      title: "登录",
    },
  },
];

/**
 * errorRouter (错误页面路由)
 */
export const errorRouter = [
  {
    path: "/404",
    name: "404",
    component: () => import("@/views/error/404.vue"),
    meta: {
      title: "404页面",
      enName: "404 Page", // 英文名称
      icon: "CircleCloseFilled", // 菜单图标
      isHide: "1", // 代表路由在菜单中是否隐藏，是否隐藏[0隐藏，1显示]
      isLink: "1", // 是否外链[有值则是外链]
      isKeepAlive: "0", // 是否缓存路由数据[0是，1否]
      isFull: "1", // 是否缓存全屏[0是，1否]
      isAffix: "1", // 是否缓存固定路由[0是，1否]
    },
  },
  // 找不到path将跳转404页面
  {
    path: "/:pathMatch(.*)*",
    component: () => import("@/views/error/404.vue"),
  },
];
