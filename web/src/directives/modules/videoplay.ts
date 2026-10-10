// directives/videoObserver.ts
import type { Directive } from "vue";

interface VideoElement extends HTMLVideoElement {
  _intersectionObserver?: IntersectionObserver;
}

const videoObserver: Directive = {
  mounted(el: VideoElement) {
    // 确保元素是视频
    if (el.tagName !== "VIDEO") return;

    // 创建 Intersection Observer
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // 静音播放
            el.muted = true;
            // 进入视口时尝试播放
            el.play().catch((e) => console.log("自动播放被阻止:", e));
          } else {
            // 离开视口时暂停并重置
            el.pause();
            el.currentTime = 0;
          }
        });
      },
      {
        threshold: 0.7, // 至少50%可见时触发
        rootMargin: "0px 0px -100px 0px", // 底部提前100px触发
      }
    );

    // 存储观察器引用以便卸载
    el._intersectionObserver = observer;
    observer.observe(el);
  },
  unmounted(el: VideoElement) {
    // 清理工作
    if (el._intersectionObserver) {
      el._intersectionObserver.disconnect();
      delete el._intersectionObserver;
    }
  },
};

export default videoObserver;
