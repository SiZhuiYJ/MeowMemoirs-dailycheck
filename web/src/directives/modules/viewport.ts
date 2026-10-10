// src/directives/viewport.ts
import type { DirectiveBinding, ObjectDirective } from 'vue'

// 指令的值类型：可以是回调函数，也可以是包含回调与配置的对象
type ViewportCallback = (entry: IntersectionObserverEntry) => void

interface ViewportBindingValue {
    handler: ViewportCallback
    options?: IntersectionObserverInit
}

// 用于存储每个元素对应的 observer 实例和回调函数
const observerMap = new WeakMap<
    Element,
    {
        observer: IntersectionObserver
        handler: ViewportCallback
    }
>()

// 创建或获取共享的 observer（若配置相同可复用，这里为简单起见每个元素独立 observer）
function createObserver(
    el: Element,
    options: IntersectionObserverInit = { threshold: 0 }
): IntersectionObserver {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            // 当元素进入视口时触发回调
            if (entry.isIntersecting) {
                const stored = observerMap.get(el)
                if (stored?.handler) {
                    stored.handler(entry)
                }
            }
        })
    }, options)

    observer.observe(el)
    return observer
}

// 指令定义
const viewportDirective: ObjectDirective<HTMLElement, ViewportBindingValue | ViewportCallback> = {
    mounted(el: HTMLElement, binding: DirectiveBinding<ViewportBindingValue | ViewportCallback>) {
        // 解析 binding.value
        let handler: ViewportCallback
        let options: IntersectionObserverInit = { threshold: 0 }

        if (typeof binding.value === 'function') {
            handler = binding.value
        } else if (binding.value && typeof binding.value === 'object') {
            handler = binding.value.handler
            options = binding.value.options || options
        } else {
            console.warn('[v-viewport] 指令值必须是函数或包含 handler 的对象')
            return
        }

        const observer = createObserver(el, options)
        observerMap.set(el, { observer, handler })
    },

    updated(el: HTMLElement, binding: DirectiveBinding<ViewportBindingValue | ViewportCallback>) {
        // 如果回调或配置发生变化，重新创建 observer
        const oldData = observerMap.get(el)
        if (!oldData) return

        let newHandler: ViewportCallback
        let newOptions: IntersectionObserverInit = { threshold: 0 }

        if (typeof binding.value === 'function') {
            newHandler = binding.value
        } else if (binding.value && typeof binding.value === 'object') {
            newHandler = binding.value.handler
            newOptions = binding.value.options || newOptions
        } else {
            return
        }

        // 若回调或关键配置变更，则更新 observer
        const optionsChanged =
            JSON.stringify(oldData.observer.thresholds) !== JSON.stringify(newOptions.threshold) ||
            oldData.observer.root !== newOptions.root ||
            oldData.observer.rootMargin !== newOptions.rootMargin

        if (oldData.handler !== newHandler || optionsChanged) {
            // 停止旧的观察
            oldData.observer.disconnect()
            // 创建新的 observer
            const newObserver = createObserver(el, newOptions)
            observerMap.set(el, { observer: newObserver, handler: newHandler })
        }
    },

    unmounted(el: HTMLElement) {
        const data = observerMap.get(el)
        if (data) {
            data.observer.disconnect()
            observerMap.delete(el)
        }
    }
}

export type { ViewportCallback, ViewportBindingValue }
export default viewportDirective
