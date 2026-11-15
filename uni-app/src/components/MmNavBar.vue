<script setup lang="ts">
import { computed } from 'vue';
import { useThemeStore } from '@/stores/theme';

/**
 * 统一自定义导航栏（毛玻璃）
 *
 * 为什么所有页面都用它：
 * 微信小程序的原生导航栏是系统 chrome，无法加背景模糊；H5 的原生导航栏下方
 * 也没有内容穿过。因此「像 web chat 顶部栏那样通透的磨砂玻璃」只能由页面自己
 * 渲染一个固定顶栏来实现。pages.json 里所有页面已改为 navigationStyle: custom。
 *
 * 结构（单个根节点，兼容小程序）：
 *   .mm-navbar-host（在文档流中，只占一个与顶栏等高的 spacer，避免内容被遮住）
 *     ├─ .mm-navbar-spacer  占位，高度 = 状态栏 + 44px 标题行（可用 spacer-offset 抵扣父级 padding-top）
 *     └─ .mm-navbar         固定定位的毛玻璃标题栏（复用 App.vue 的 .mm-frosted-header）
 *
 * 适配细节：
 * · 状态栏高度取自 uni.getSystemInfoSync().statusBarHeight（H5 为 0）；
 * · 微信小程序右上角胶囊通过 getMenuButtonBoundingClientRect() 预留右侧安全区，
 *   标题与右侧插槽不会被胶囊压住；
 * · 返回按钮：页面栈 > 1 时 navigateBack，否则 reLaunch 回主页（H5 直接打开子页也能返回）。
 *
 * 用法：
 *   子页面：<MmNavBar title="修改昵称" />
 *   tab 页：<MmNavBar :show-back="false" align="left" title="设置" :spacer-offset="12" />
 *   自定义内容：<MmNavBar><template #left>…</template><template #right>…</template></MmNavBar>
 */
const props = withDefaults(
  defineProps<{
    /** 标题文字（也可用默认插槽传自定义节点） */
    title?: string;
    /** 是否显示返回按钮（主界面 tab 页传 false） */
    showBack?: boolean;
    /** 标题对齐方式：子页面居中，主界面 tab 页靠左 */
    align?: 'left' | 'center';
    /** 是否渲染占位 spacer（默认 true，防止页面内容被固定顶栏遮住） */
    spacer?: boolean;
    /** 抵扣父级容器 padding-top 的 px 值，使内容正好贴在顶栏下方 */
    spacerOffset?: number;
    /** 是否启用毛玻璃底（false 时用纯色底，例如裁剪页等沉浸页面） */
    glass?: boolean;
    /** 是否显示底部分割线 */
    border?: boolean;
  }>(),
  {
    title: '',
    showBack: true,
    align: 'center',
    spacer: true,
    spacerOffset: 0,
    glass: true,
    border: true,
  },
);

const emit = defineEmits<{ (e: 'back'): void }>();

const themeStore = useThemeStore();

/** 标题行高度；与 App.vue 里的 --navbar-h 保持一致（44px） */
const BAR_HEIGHT = 44;

const sysInfo = uni.getSystemInfoSync();
const statusBarHeight = sysInfo.statusBarHeight || 0;

/** 微信小程序右上角胶囊预留宽度（H5 / App 端为 0） */
let capsuleInset = 0;
// #ifdef MP-WEIXIN
try {
  const menu = uni.getMenuButtonBoundingClientRect();
  capsuleInset = Math.max(sysInfo.windowWidth - menu.left + 8, 0);
} catch (e) {
  capsuleInset = 0;
}
// #endif

const totalHeight = computed(() => statusBarHeight + BAR_HEIGHT);

const barStyle = computed(() => ({
  paddingTop: `${statusBarHeight}px`,
  paddingLeft: '12px',
  // 有胶囊时右侧让出胶囊宽度，没有时留常规内边距
  paddingRight: capsuleInset > 0 ? `${capsuleInset}px` : '12px',
}));

const spacerStyle = computed(() => ({
  height: `${Math.max(totalHeight.value - props.spacerOffset, 0)}px`,
}));

function handleBack() {
  emit('back');
  try {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      uni.navigateBack({ delta: 1 });
    } else {
      uni.reLaunch({ url: '/pages/main/index' });
    }
  } catch (e) {
    uni.reLaunch({ url: '/pages/main/index' });
  }
}
</script>

<template>
  <view class="mm-navbar-host">
    <view v-if="spacer" class="mm-navbar-spacer" :style="spacerStyle"></view>
    <view
      class="mm-navbar"
      :class="[
        glass ? 'mm-frosted-header' : 'mm-navbar-solid',
        border ? '' : 'mm-navbar-no-border',
      ]"
      :style="barStyle"
    >
      <view class="mm-navbar-inner">
        <!-- 返回按钮：36px 热区；箭头用 CSS 绘制（仓库 turn-left.svg 实际是朝右的图标，
             直接引用会导致方向反转；CSS 箭头还能自动跟随日/夜主题变色） -->
        <view v-if="showBack" class="mm-navbar-back" hover-class="mm-hover" @click="handleBack">
          <view class="mm-navbar-back-icon"></view>
        </view>

        <!-- 左侧插槽：主界面放周次等自定义内容 -->
        <view class="mm-navbar-left">
          <slot name="left"></slot>
        </view>

        <!-- 标题：子页面居中，tab 页靠左 -->
        <view class="mm-navbar-title" :class="`align-${align}`">
          <slot>{{ title }}</slot>
        </view>

        <!-- 右侧插槽：页面操作按钮（如课程页「今天」） -->
        <view class="mm-navbar-right">
          <slot name="right"></slot>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
/* 宿主在文档流里只占 spacer 的高度；固定顶栏浮在内容上方 */
.mm-navbar-host {
  width: 100%;
}

.mm-navbar-spacer {
  width: 100%;
}

.mm-navbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 900;
  box-sizing: border-box;
}

.mm-navbar-inner {
  display: flex;
  align-items: center;
  height: 44px;
}

.mm-navbar-back {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin-left: -6px;
  border-radius: 50%;
}

/* 朝左的 chevron：右/下描边旋转 135°，颜色随 --text-color 自动适配日/夜主题 */
.mm-navbar-back-icon {
  width: 10px;
  height: 10px;
  box-sizing: border-box;
  border-style: solid;
  border-color: var(--text-color);
  border-width: 0 2px 2px 0;
  transform: rotate(135deg);
  margin-left: 3px;
}

.mm-navbar-left,
.mm-navbar-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.mm-navbar-right {
  margin-left: 8px;
}

.mm-navbar-title {
  flex: 1 1 0;
  min-width: 0;
  font-size: 17px;
  font-weight: 600;
  line-height: 44px;
  color: var(--text-color);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mm-navbar-title.align-center {
  text-align: center;
}

.mm-navbar-title.align-left {
  text-align: left;
}

/* glass=false 时的纯色顶栏（沉浸式页面用） */
.mm-navbar-solid {
  background-color: var(--bg-color);
}

.mm-navbar-no-border {
  border-bottom: none;
}
</style>
