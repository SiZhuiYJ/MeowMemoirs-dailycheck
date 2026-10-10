<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { useThemeStore } from '@/stores/theme';
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
  <view class="container" :style="themeStore.themeStyle">
    <view class="section">
      <text class="label">反馈内容</text>
      <textarea class="textarea" v-model="feedbackText" placeholder="请描述您遇到的问题或改进建议..." />
    </view>
    <view class="section">
      <text class="label">联系方式（可选）</text>
      <input class="input" v-model="contactInfo" placeholder="邮箱/手机号" />
    </view>
    <button class="submit-btn" @click="submitFeedback">提交反馈</button>
  </view>
</template>

<style scoped lang="scss">
.container {
  min-height: 100vh;
  background-color: var(--bg-color);
  padding: 20px;
}
.section {
  margin-bottom: 24px;
}
.label {
  display: block;
  font-size: 15px;
  color: var(--text-color);
  margin-bottom: 8px;
  font-weight: 500;
}
.textarea {
  width: 100%;
  height: 200px;
  background-color: var(--bg-elevated);
  border-radius: 12px;
  padding: 12px;
  border: 1px solid var(--border-color);
  box-sizing: border-box;
}
.input {
  width: 100%;
  height: 48px;
  background-color: var(--bg-elevated);
  border-radius: 12px;
  padding: 0 12px;
  border: 1px solid var(--border-color);
  box-sizing: border-box;
}
.submit-btn {
  background-color: var(--theme-primary);
  color: #fff;
  border-radius: 24px;
  height: 48px;
  line-height: 48px;
  margin-top: 40px;
  font-weight: bold;
}
</style>
