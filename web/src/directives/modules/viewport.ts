// src/directives/viewport.ts
import type { DirectiveBinding, ObjectDirective } from 'vue'

// 指令的值类型：可以是回调函数，也可以是包含回调与配置的对象
type ViewportCallback = (entry: IntersectionObserverEntry) => void

interface ViewportBindingValue {
    handler: ViewportCallback
    options?: IntersectionObserverInit
    /** 首次进入视口后停止观察（图片懒加载这类只需要触发一次的场景）。 */
    once?: boolean
}

interface ElementState {
    observer: IntersectionObserver
    handler: ViewportCallback
    once: boolean
    optionsKey: string
}

/**
 * 共享 IntersectionObserver。
 *
 * 旧实现给每个元素 new 一个 observer，长消息列表里就是几百个 observer；
 * `updated` 钩子还会在每次父组件重渲染时用 JSON.stringify 比较 thresholds。
 * 现在按「root + rootMargin + threshold」复用同一个 observer，
 * 回调按元素分发；配置没变时只替换回调，不重建 observer。
 */
const elementStates = new WeakMap<Element, ElementState>()
/** root 为视口（null）时的共享 observer。 */
const viewportObservers = new Map<string, IntersectionObserver>()
/** 指定了 root 元素时的共享 observer。 */
const rootObservers = new WeakMap<Element | Document, Map<string, IntersectionObserver>>()

function optionsKey(options: IntersectionObserverInit): string {
    const rootMargin = options.rootMargin ?? '0px'
    const threshold = options.threshold ?? 0
    return `${rootMargin}|${JSON.stringify(threshold)}`
}

function createObserver(options: IntersectionObserverInit): IntersectionObserver {
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue

            const state = elementStates.get(entry.target)
            if (!state) continue

            state.handler(entry)
            if (state.once) observer.unobserve(entry.target)
        }
    }, options)

    return observer
}

function acquireObserver(options: IntersectionObserverInit): IntersectionObserver {
    const key = optionsKey(options)
    const root = options.root

    if (root) {
        let map = rootObservers.get(root)
        if (!map) {
            map = new Map()
            rootObservers.set(root, map)
        }
        let observer = map.get(key)
        if (!observer) {
            observer = createObserver(options)
            map.set(key, observer)
        }
        return observer
    }

    let observer = viewportObservers.get(key)
    if (!observer) {
        observer = createObserver(options)
        viewportObservers.set(key, observer)
    }
    return observer
}

function parseBinding(binding: DirectiveBinding<ViewportBindingValue | ViewportCallback>) {
    const value = binding.value

    if (typeof value === 'function') {
        return { handler: value, options: {} as IntersectionObserverInit, once: false }
    }
    if (value && typeof value === 'object' && typeof value.handler === 'function') {
        return {
            handler: value.handler,
            options: value.options ?? {},
            once: value.once === true,
        }
    }
    return null
}

const viewportDirective: ObjectDirective<HTMLElement, ViewportBindingValue | ViewportCallback> = {
    mounted(el: HTMLElement, binding: DirectiveBinding<ViewportBindingValue | ViewportCallback>) {
        const parsed = parseBinding(binding)
        if (!parsed) {
            console.warn('[v-viewport] 指令值必须是函数或包含 handler 的对象')
            return
        }

        const observer = acquireObserver(parsed.options)
        elementStates.set(el, {
            observer,
            handler: parsed.handler,
            once: parsed.once,
            optionsKey: optionsKey(parsed.options),
        })
        observer.observe(el)
    },

    updated(el: HTMLElement, binding: DirectiveBinding<ViewportBindingValue | ViewportCallback>) {
        const state = elementStates.get(el)
        if (!state) return

        const parsed = parseBinding(binding)
        if (!parsed) return

        // 回调与 once 直接替换，不重建 observer。
        state.handler = parsed.handler
        state.once = parsed.once

        const nextKey = optionsKey(parsed.options)
        if (nextKey === state.optionsKey) return

        // 只有观察配置变了才需要换 observer。
        state.observer.unobserve(el)
        const observer = acquireObserver(parsed.options)
        state.observer = observer
        state.optionsKey = nextKey
        observer.observe(el)
    },

    unmounted(el: HTMLElement) {
        const state = elementStates.get(el)
        if (!state) return

        state.observer.unobserve(el)
        elementStates.delete(el)
    },
}

export type { ViewportCallback, ViewportBindingValue }
export default viewportDirective
