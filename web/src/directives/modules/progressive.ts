// src/directives/progressive.ts
import type { Directive, DirectiveBinding } from "vue";
// import { getCurrentInstance } from "vue";

interface ProgressiveImageBinding extends DirectiveBinding {
  value: string; // 小图（预览图）URL
  modifiers: {
    lazy?: boolean; // 使用 v-progressive.lazy 启用懒加载
  };
}

const ProgressiveDirective: Directive = {
  mounted(el: HTMLImageElement, binding: ProgressiveImageBinding) {
    const { value: previewUrl, modifiers } = binding;
    const mainUrl = el.src;
    // 如果已经是预览图，不需要处理
    if (el.src === previewUrl) return;

    // 先设置src为预览图
    el.src = previewUrl;
    el.classList.add("progressive-preview");

    if (modifiers.lazy) {
      setupLazyLoad(el, mainUrl);
    } else {
      loadMainImage(el, mainUrl);
    }
  },
};

/**
 * 加载主图并应用过渡效果
 */
function loadMainImage(el: HTMLImageElement, mainUrl: string) {
  const img = new Image();
  img.src = mainUrl;

  img.onload = () => {
    // 添加淡入效果
    el.classList.add("progressive-fade");
    el.src = mainUrl;

    // 图片加载完成后移除预览类
    el.addEventListener(
      "transitionend",
      () => {
        el.classList.remove("progressive-preview", "progressive-fade");
      },
      { once: true }
    );
  };

  img.onerror = () => {
    console.error(`Failed to load image: ${mainUrl}`);
    el.classList.remove("progressive-preview");
  };
}

/**
 * 设置IntersectionObserver实现懒加载
 */
function setupLazyLoad(el: HTMLImageElement, mainUrl: string) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          // 当图片进入可视区域时加载主图
          loadMainImage(el, mainUrl);
          // 加载完成后停止观察
          observer.unobserve(el);
        }
      });
    },
    {
      rootMargin: "0px",
      threshold: 0.1,
    }
  );

  // 开始观察元素
  observer.observe(el);

  // 在组件卸载时停止观察(可选)
  // 如果需要在Vue组件中使用，可以通过指令的unmounted钩子实现
}

export default ProgressiveDirective;
