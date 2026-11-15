<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { useThemeStore } from '@/stores/theme';
import MmNavBar from '@/components/MmNavBar.vue';
import { ref } from 'vue';

const themeStore = useThemeStore();

onShow(() => {
  themeStore.updateNavBarColor();
});

const feedbackText = ref('');
const contactInfo = ref('');

function submitFeedback() {
  if (!feedbackText.value.trim()) {
    uni.showToast({ title: '请输入反馈内容', icon: 'none' });
    return;
  }
  uni.showLoading({ title: '提交中...' });
  setTimeout(() => {
    uni.hideLoading();
    uni.showToast({ title: '提交成功，感谢您的反馈！' });
    setTimeout(() => uni.navigateBack(), 1500);
  }, 1000);
}
</script>

<template>
  <view class="page-container" :style="themeStore.themeStyle">
    <!-- 毛玻璃顶栏：page-container 顶部 padding 16px，作为内容与顶栏之间的间距 -->
    <MmNavBar title="意见反馈" />
    <text class="group-title">意见反馈</text>

    <!-- 表单白卡片：输入/文本域 44px 控件规范 + 主题色聚焦描边 -->
    <view class="page-card">
      <view class="form-field">
        <text class="label">反馈内容</text>
        <textarea class="textarea" v-model="feedbackText" placeholder="请描述您遇到的问题或改进建议..." />
      </view>

      <view class="form-field last-field">
        <text class="label">联系方式（可选）</text>
        <input class="input" v-model="contactInfo" placeholder="邮箱/手机号" />
      </view>
    </view>

    <view class="page-actions">
      <button class="btn-primary" hover-class="mm-hover" @click="submitFeedback">提交反馈</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
@use "@/styles/page-layouts.scss";

/* 分组小标题：13px / 600 灰字 */
.group-title {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.02em;
  margin: 0 2px 8px;
}

.last-field {
  margin-bottom: 0;
}

/* 多行文本域：1px 描边 + 10 圆角，聚焦时主题色描边 */
.textarea {
  width: 100%;
  height: 180px;
  padding: 12px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-color);
  box-sizing: border-box;
}

.textarea:focus,
.textarea:focus-within {
  border-color: var(--theme-primary);
}

/* 单行输入框聚焦描边（:focus-within 兼容 H5 的 uni-input 包裹层） */
.input:focus,
.input:focus-within {
  border-color: var(--theme-primary);
}
</style>
