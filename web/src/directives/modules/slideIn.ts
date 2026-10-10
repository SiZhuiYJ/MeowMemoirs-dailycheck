import type { Directive } from "vue";

const OFFSET = 80; // start slightly below
const DURATION = 700; // slow upward animation
const BASE_DELAY = 150; // delay after entering viewport to avoid instant move on downward scroll
const STAGGER_GAP = 180; // spacing between sequential plays

const animationMap = new WeakMap<Element, Animation>();
let nextAvailableTime = 0;
let lastScrollY = window.scrollY;
let scrollingUp = false;
let listenerAttached = false;

function ensureScrollListener() {
  if (listenerAttached) return;
  const onScroll = () => {
    const currentY = window.scrollY;
    scrollingUp = currentY < lastScrollY;
    lastScrollY = currentY;
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  listenerAttached = true;
}

function isBelowViewport(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  return rect.top > window.innerHeight;
}

const ob = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;

    const animation = animationMap.get(entry.target);
    if (!animation) return;

    // Skip when entering from above (user scrolling upward to re-read)
    const rootTop = entry.rootBounds?.top ?? 0;
    if (entry.boundingClientRect.top < rootTop) {
      (entry.target as HTMLElement).style.opacity = "";
      (entry.target as HTMLElement).style.transform = "";
      ob.unobserve(entry.target);
      return;
    }

    // Queue play time to prevent simultaneous animations
    const now = performance.now();
    const scheduledStart = Math.max(now + BASE_DELAY, nextAvailableTime);
    const delay = Math.max(0, scheduledStart - now);
    nextAvailableTime = scheduledStart + STAGGER_GAP;

    setTimeout(() => {
      animation.play();
      (entry.target as HTMLElement).style.opacity = "";
      (entry.target as HTMLElement).style.transform = "";
    }, delay);

    ob.unobserve(entry.target);
  });
});

function setupAnimation(el: HTMLElement) {
  el.style.opacity = "0";
  el.style.transform = `translateY(${OFFSET}px)`;

  const animation = el.animate(
    [
      { transform: `translateY(${OFFSET}px)`, opacity: 0 },
      { transform: "translateY(0)", opacity: 1 },
    ],
    { duration: DURATION, easing: "ease-out", fill: "forwards" }
  );

  animation.pause();
  animation.currentTime = 0;

  animationMap.set(el, animation);
  ob.observe(el);
}

const slideIn: Directive = {
  mounted(el: HTMLElement) {
    ensureScrollListener();

    // If user is scrolling upward and item is already visible, skip replay
    if (scrollingUp && !isBelowViewport(el)) {
      el.style.opacity = "";
      el.style.transform = "";
      return;
    }
    setupAnimation(el);
  },
  updated(el: HTMLElement) {
    ensureScrollListener();

    const existing = animationMap.get(el);
    if (existing) {
      existing.cancel();
      animationMap.delete(el);
    }
    ob.unobserve(el);

    // Allow replay on updates unless user is currently scrolling upward and the item is already visible
    if (scrollingUp && !isBelowViewport(el)) {
      el.style.opacity = "";
      el.style.transform = "";
      return;
    }
    setupAnimation(el);
  },
  unmounted(el: HTMLElement) {
    ob.unobserve(el);
    const existing = animationMap.get(el);
    if (existing) existing.cancel();
    animationMap.delete(el);
  },
};

export default slideIn;
