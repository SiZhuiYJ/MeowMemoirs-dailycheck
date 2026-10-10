import type { DefineComponent, Component } from 'vue'

// 核心路由组件类型
export type RouteComponent =
    | DefineComponent  // 同步组件
    | (() => Promise<DefineComponent>) // 异步组件
    | Component // 兼容传统组件类型

// 路由元数据接口
export interface RouteMeta {
    parentId?: number
    activeMenu: string | undefined
    enName: string
    icon: string
    isAffix: string
    isFull: string
    isHide: string
    isKeepAlive: string
    isLink: string
    title: string
}


// 路由项接口
export interface AppRouteRecordRaw {
    path: string
    name: string
    component: RouteComponent
    redirect: string
    meta: RouteMeta
    children: AppRouteRecordRaw[]
}
export interface RouterItem {
    children: RouterItem[]
    component: RouteComponent
    meta: {
        activeMenu: string | undefined
        enName: string
        icon: string
        isAffix: string
        isFull: string
        isHide: string
        isKeepAlive: string
        isLink: string
        title: string
    }
    name: string
    path: string
    redirect: string
}