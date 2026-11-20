<script setup lang="ts">
import { computed, ref, reactive } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import http from '@/libs/http/config';
import { apiBase, getApiBase, thumbnailUrl } from '@/libs/http/apiBase';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { notifySuccess, notifyError } from '@/utils/notification';
import {
  getBoundThirdPartyLabels,
  normalizeThirdPartyBindings,
} from '@/utils/third-party';
import MmNavBar from '@/components/MmNavBar.vue';
import MmLazyImage from '@/components/MmLazyImage.vue';

const authStore = useAuthStore();
const themeStore = useThemeStore();

const loading = ref(false);

/** 当前用户头像地址 */
const avatarUrl = computed(() => {
  const user = authStore.user;
  return user?.avatarKey ? `${apiBase.value}/mm/Files/users/${user.userId}/${user.avatarKey}` : '';
});

/** 头像缩略占位图（服务端 96px _thumb；无缩略图时后端回退原图） */
const avatarThumbUrl = computed(() => thumbnailUrl(avatarUrl.value));

/** 头像卡背景图地址：优先用户自定义背景，未设置时回退到头像（与改动前视觉一致） */
const profileBackgroundUrl = computed(() => {
  const user = authStore.user;
  if (!user) return '';
  const key = user.profileBackgroundKey || user.avatarKey;
  return key ? `${apiBase.value}/mm/Files/users/${user.userId}/${key}` : '';
});

/** 背景缩略占位图（服务端上传时预处理生成，128px 小图）：先铺底，原图加载完再淡入 */
const profileBackgroundThumbUrl = computed(() => thumbnailUrl(profileBackgroundUrl.value));

/** 是否已设置自定义背景（决定操作表项与「查看大图 / 恢复默认」是否可用） */
const hasCustomBackground = computed(() => !!authStore.user?.profileBackgroundKey);

/** 已绑定第三方渠道的中文名，例如 ['微信']（个人主页展示用，避免只显示数量） */
const boundThirdPartyLabels = computed(() =>
  getBoundThirdPartyLabels(authStore.user?.thirdPartyBindings),
);

/** 第三方绑定入口右侧的状态文案：未绑定 / 已绑定微信 */
const thirdPartyBindSummary = computed(() => {
  const labels = boundThirdPartyLabels.value;
  return labels.length ? `已绑定${labels.join('、')}` : '未绑定';
});

onShow(async () => {
  themeStore.updateNavBarColor();
  await authStore.fetchUserInfo();
  // 获取第三方绑定信息
  await fetchThirdPartyBindings();
});

// 获取第三方绑定信息
async function fetchThirdPartyBindings() {
  try {
    const res = await http.get('/mm/Auth/bindings');
    if (res.statusCode === 200) {
      // 更新用户信息中的第三方绑定数据（统一解析，兼容后端字段大小写）
      authStore.updateUser({
        thirdPartyBindings: normalizeThirdPartyBindings(res.data)
      });
    }
  } catch (error) {
    console.error('Failed to fetch third party bindings', error);
  }
}

function handleNavigate(url: string) {
  uni.navigateTo({ url });
}

function handleViewAvatar() {
  if (authStore.user?.avatarKey && avatarUrl.value) {
    uni.previewImage({
      urls: [avatarUrl.value],
      current: 0
    });
  }
}

/** 预览当前头像卡背景图（自定义背景或回退的头像图） */
function handlePreviewBackground() {
  if (!profileBackgroundUrl.value) return;
  uni.previewImage({
    urls: [profileBackgroundUrl.value],
    current: 0
  });
}

/** 是否有可用的上次头像（没有时不显示「使用上次头像」入口） */
const hasPreviousAvatar = computed(() => Boolean(authStore.user?.previousAvatarKey));

/** 上次头像地址（确认对话框里预览用） */
const previousAvatarUrl = computed(() => {
  const user = authStore.user;
  return user?.previousAvatarKey ? `${apiBase.value}/mm/Files/users/${user.userId}/${user.previousAvatarKey}` : '';
});

/** 上次头像缩略占位图（服务端 96px _thumb） */
const previousAvatarThumbUrl = computed(() => thumbnailUrl(previousAvatarUrl.value));

/** 「上次头像」确认对话框显隐 / 切换进行中 */
const showPreviousAvatarDialog = ref(false);
const switchingPreviousAvatar = ref(false);

function openPreviousAvatarDialog() {
  if (!hasPreviousAvatar.value) return;
  showPreviousAvatarDialog.value = true;
}

function closePreviousAvatarDialog() {
  // 切换请求进行中时不允许关闭，避免状态错乱
  if (switchingPreviousAvatar.value) return;
  showPreviousAvatarDialog.value = false;
}

/** 使用上次头像：调用后端把当前头像与上次头像互换 */
async function usePreviousAvatar() {
  if (switchingPreviousAvatar.value) return;

  switchingPreviousAvatar.value = true;
  uni.showLoading({ title: '切换中...', mask: true });
  try {
    const res = await http.post<{ key: string; previousKey?: string | null }>('/mm/Files/avatar/use-previous');
    const data = res.data;
    if (res.statusCode === 200 && data?.key) {
      authStore.updateUser({
        avatarKey: data.key,
        previousAvatarKey: data.previousKey !== undefined ? data.previousKey : null
      });
      showPreviousAvatarDialog.value = false;
      notifySuccess('已切换为上次头像');
    } else {
      notifyError('切换上次头像失败');
    }
  } catch (error: any) {
    if (error?.statusCode === 400) {
      notifyError('暂无可用的上次头像');
      showPreviousAvatarDialog.value = false;
    } else {
      notifyError('切换上次头像失败');
    }
  } finally {
    switchingPreviousAvatar.value = false;
    uni.hideLoading();
  }
}

/** 头像卡右上角「更换背景」入口：按当前状态弹出操作表 */
function handleBackgroundSettings() {
  const hasCustom = hasCustomBackground.value;
  const itemList = hasCustom
    ? ['更换背景', '查看大图', '恢复默认背景']
    : ['设置背景'];
  uni.showActionSheet({
    itemList,
    success: (res) => {
      if (!hasCustom || res.tapIndex === 0) {
        pickAndUploadBackground();
      } else if (res.tapIndex === 1) {
        handlePreviewBackground();
      } else if (res.tapIndex === 2) {
        handleResetBackground();
      }
    }
  });
}

/** 选图 → 1:1 裁剪页（保留原图像素）→ 上传为新背景 */
function pickAndUploadBackground() {
  uni.chooseImage({
    count: 1,
    // 背景图铺满整张卡片：优先选原图，1:1 裁剪后保留裁剪区域的原始像素，不做二次缩放
    sizeType: ['original', 'compressed'],
    sourceType: ['album', 'camera'],
    success: (chooseRes) => {
      const tempFilePath = chooseRes.tempFilePaths?.[0];
      if (!tempFilePath) return;

      /** 带尺寸跳 1:1 裁剪页：width/height = 输出边长（正方形），filetype=jpg quality=92 */
      const openCropper = (side: number) => {
        uni.navigateTo({
          // 保留裁剪后的原始像素：输出边长 = 原图短边（上限 4096 的微信画布安全上限），
          // 不再固定 1200px；服务端也不再缩放像素（仅转 WebP + 生成 128px 缩略图），
          // 单张上传上限 20MB
          url: `/pages/common/cropper?src=${tempFilePath}&width=${side}&height=${side}&filetype=jpg&quality=92`,
          events: {
            cropSuccess: (data: { tempFilePath?: string }) => {
              if (data?.tempFilePath) uploadProfileBackground(data.tempFilePath);
            }
          }
        });
      };

      // 先读原图宽高：正方形裁剪能保留的最大边长 = 短边；
      // 4096 是微信 canvas 的安全上限，普通 12MP 手机照片短边约 3024，可保持原像素不被缩小。
      uni.getImageInfo({
        src: tempFilePath,
        success: (info) => {
          const width = Number(info?.width) || 0;
          const height = Number(info?.height) || 0;
          const side = Math.min(width, height, 4096);
          // 宽高异常（拿不到有效值）时回退 1600，避免生成 width=0 的坏 URL
          openCropper(side > 0 ? side : 1600);
        },
        fail: () => {
          // 拿不到原图尺寸：回退 1600，保证流程仍可用
          openCropper(1600);
        }
      });
    }
  });
}

/** 上传裁剪后的背景图，成功后写回 store */
function uploadProfileBackground(filePath: string) {
  loading.value = true;
  uni.showLoading({ title: '上传中...', mask: true });
  uni.uploadFile({
    url: `${getApiBase()}/mm/Files/profile-background`,
    filePath: filePath,
    name: 'file',
    header: {
      'Authorization': `Bearer ${authStore.accessToken}`
    },
    success: (uploadRes) => {
      loading.value = false;
      uni.hideLoading();
      if (uploadRes.statusCode >= 200 && uploadRes.statusCode < 300) {
        try {
          const data = JSON.parse(uploadRes.data);
          const key = data?.key;
          if (key) {
            authStore.updateUser({ profileBackgroundKey: key });
            notifySuccess('背景图上传成功');
          } else {
            notifyError('背景图上传失败: 无效的响应');
          }
        } catch (e) {
          notifyError('背景图上传失败: 数据解析错误');
        }
      } else {
        notifyError('背景图上传失败');
      }
    },
    fail: () => {
      loading.value = false;
      uni.hideLoading();
      notifyError('背景图上传失败: 网络错误');
    }
  });
}

/** 恢复默认背景：删除自定义背景，回退到头像图 */
async function handleResetBackground() {
  uni.showLoading({ title: '处理中...', mask: true });
  try {
    await http.delete('/mm/Files/profile-background');
    authStore.updateUser({ profileBackgroundKey: null });
    notifySuccess('已恢复默认背景');
  } catch (error) {
    notifyError('恢复默认背景失败');
  } finally {
    uni.hideLoading();
  }
}

function handleEditAvatar() {
  // 入口始终展示，避免用户以为功能没上线；暂无上次头像时点击给出说明。
  uni.showActionSheet({
    itemList: ['使用微信头像', '选择照片', '使用上次头像'],
    success: async (res) => {
      if (res.tapIndex === 0) {
        // WeChat Avatar
        // Since uni.getUserProfile is limited, we try to guide the user or use uni.chooseImage with special handling if possible.
        // However, standard practice now is often just letting them pick.
        // We will try a simple approach: Just fetch it? No, can't.
        // We will use uni.getUserProfile if available (deprecated but works in some contexts) or warn.
        // Actually, let's just use chooseImage/chooseMedia but maybe the user expects the "WeChat Avatar" button behavior.
        // Since we can't invoke that programmatically from ActionSheet, we might just try to use uni.getUserProfile to get the URL.
        // Note: As of 2022, getUserProfile returns grey avatar. 
        // Best approach for "WeChat Avatar" option in a custom UI without a specific button is tricky.
        // We'll treat it as a "Select from Album" but maybe user has saved it?
        // Let's implement the 'Select Photo' flow primarily, and for 'WeChat Avatar' maybe show a toast explaining they should select it from album if they can't authorize.
        // OR: We try `uni.getUserProfile` and if it works (old base lib) great.

        // Actually, let's try to just use uni.chooseImage for both but maybe with different source?
        // No.
        // Let's just implement "Select Photo" fully first as that covers "File Upload".
        // For "WeChat Avatar", if we are in MP-WEIXIN:
        // We can't easily get it.
        // I will implement a workaround: Provide a "Use WeChat Avatar" button that calls getUserProfile.
        // If it fails or returns placeholder, I'll alert the user.

        // #ifdef MP-WEIXIN
        uni.getUserProfile({
          desc: '用于完善会员资料',
          success: (profileRes) => {
            // profileRes.userInfo.avatarUrl might be temporary or grey.
            // If valid, we download it.
            const avatarUrl = profileRes.userInfo.avatarUrl;
            downloadAndUpload(avatarUrl);
          },
          fail: () => {
            // If fail, maybe they cancelled or not supported.
            uni.showToast({ title: '无法获取微信头像，请尝试文件上传', icon: 'none' });
          }
        });
        // #endif

        // #ifndef MP-WEIXIN
        uni.showToast({ title: '仅微信小程序支持', icon: 'none' });
        // #endif

      } else if (res.tapIndex === 1) {
        // Select Photo
        uni.chooseImage({
          count: 1,
          sizeType: ['compressed'],
          sourceType: ['album', 'camera'],
          success: (chooseRes) => {
            const tempFilePaths = chooseRes.tempFilePaths;
            if (tempFilePaths.length > 0) {
              // Navigate to cropper
              uni.navigateTo({
                url: `/pages/common/cropper?src=${tempFilePaths[0]}`,
                events: {
                  cropSuccess: (data: any) => {
                    uploadFile(data.tempFilePath);
                  }
                }
              });
            }
          }
        });
      } else if (res.tapIndex === 2) {
        // 使用上次头像：没有历史时明确提示，有历史则弹窗展示上次头像并确认
        if (!hasPreviousAvatar.value) {
          uni.showModal({
            title: '暂无可用的上次头像',
            content: '更换一次头像后，这里会展示并可切回上一次使用的头像。',
            showCancel: false,
            confirmText: '知道了'
          });
          return;
        }
        openPreviousAvatarDialog();
      }
    }
  });
}

function downloadAndUpload(url: string) {
  uni.showLoading({ title: '上传中...' });
  uni.downloadFile({
    url: url,
    success: (res) => {
      if (res.statusCode === 200) {
        uploadFile(res.tempFilePath);
      } else {
        uni.hideLoading();
        notifyError('头像下载失败');
      }
    },
    fail: () => {
      uni.hideLoading();
      notifyError('头像下载失败');
    }
  });
}

function uploadFile(filePath: string) {
  loading.value = true;
  uni.uploadFile({
    url: `${getApiBase()}/mm/Files/avatar`,
    filePath: filePath,
    name: 'file',
    header: {
      'Authorization': `Bearer ${authStore.accessToken}`
    },
    success: (uploadRes) => {
      loading.value = false;
      uni.hideLoading(); // Just in case
      if (uploadRes.statusCode === 200) {
        try {
          const data = JSON.parse(uploadRes.data);
          const key = data.key;
          if (key && authStore.user?.userId) {
            // 服务端上传成功会返回旧头像 key（首次上传为 null）
            authStore.updateUser(
              data.previousKey !== undefined
                ? { avatarKey: key, previousAvatarKey: data.previousKey }
                : { avatarKey: key }
            );
            notifySuccess('头像上传成功');
          } else {
            notifyError('头像上传失败: 无效的响应');
          }
        } catch (e) {
          notifyError('头像上传失败: 数据解析错误');
        }
      } else {
        notifyError('头像上传失败');
      }
    },
    fail: (err) => {
      loading.value = false;
      uni.hideLoading();
      notifyError('头像上传失败: 网络错误');
    }
  });
}

// Deprecated old handler, kept just in case but we use separate handlers now
async function handleAvatarClick() {
  handleEditAvatar();
}

// 注销逻辑已移至独立页面 /pages/profile/deactivate
</script>

<template>
  <view class="container" :style="themeStore.themeStyle">
    <!-- 毛玻璃顶栏：根容器 padding-top = 16px（--page-pad），作为内容与顶栏之间的间距 -->
    <MmNavBar title="个人信息" />
    <NotificationSystem />

    <!-- 头像卡：先用 128px 缩略占位图铺底，原图加载完成后淡入（渐进/懒加载，见 MmLazyImage）；
         无自定义背景时回退头像图作背景。背景预览只绑在背景层，头像点击不会误触背景 -->
    <view class="card profile-header">
      <view v-if="profileBackgroundUrl" class="profile-bg" @click="handlePreviewBackground">
        <mm-lazy-image class="profile-bg-img" :src="profileBackgroundUrl" :thumbnail="profileBackgroundThumbUrl"
          mode="aspectFill" />
      </view>
      <view class="bg-setting-btn" hover-class="mm-hover" @click.stop="handleBackgroundSettings">
        <view class="bg-setting-icon"></view>
      </view>
      <view class="fade-bottom">
        <view class="avatar-large">
          <!-- 用原生 view 承载点击：小程序里 @click 在自定义组件上不冒泡成 tap，会导致点头像误触发卡片背景预览 -->
          <view v-if="avatarUrl" class="avatar-click" @click.stop="handleViewAvatar">
            <mm-lazy-image class="avatar-img" :src="avatarUrl" :thumbnail="avatarThumbUrl" mode="aspectFill" />
          </view>
          <text v-else class="avatar-text-large" @click.stop="handleViewAvatar">{{ (authStore.user?.nickName ||
            authStore.user?.userAccount ||
            authStore.user?.email ||
            'U')[0].toUpperCase() }}</text>
          <view class="avatar-edit-overlay" hover-class="mm-hover" @click.stop="handleEditAvatar">
            <text class="edit-icon">✎</text>
          </view>
        </view>
        <view class="user-info" @click.stop>
          <text class="user-name">{{ authStore.user?.nickName }}</text>
          <text class="user-email">{{ authStore.user?.email }}</text>
        </view>

      </view>
    </view>

    <!-- 菜单列表：白卡片 + 分割线 + 右侧箭头，行高 ≥ 44px -->
    <view class="card">
      <view class="list-group">
        <view class="list-item" hover-class="mm-hover" @click="handleNavigate('/pages/profile/update-account')">
          <text class="item-label">账号</text>
          <view class="item-value">
            <text class="value-text">{{ authStore.user?.userAccount || '未设置' }}</text>
            <image class="arrow-icon" src="/static/svg/turn-right.svg" mode="aspectFit" />
          </view>
        </view>
        <view class="list-item" hover-class="mm-hover" @click="handleNavigate('/pages/profile/update-nickname')">
          <text class="item-label">昵称</text>
          <view class="item-value">
            <text class="value-text">{{ authStore.user?.nickName || '未设置' }}</text>
            <image class="arrow-icon" src="/static/svg/turn-right.svg" mode="aspectFit" />
          </view>
        </view>
        <view class="list-item" hover-class="mm-hover" @click="handleNavigate('/pages/profile/update-password')">
          <text class="item-label">修改密码</text>
          <view class="item-value">
            <text class="value-text">点击修改</text>
            <image class="arrow-icon" src="/static/svg/turn-right.svg" mode="aspectFit" />
          </view>
        </view>
      </view>
    </view>

    <view class="card">
      <view class="list-group">
        <view class="list-item" hover-class="mm-hover" @click="handleNavigate('/pages/profile/third-party-binds')">
          <text class="item-label">第三方账号绑定</text>
          <view class="item-value">
            <text class="value-text">{{ thirdPartyBindSummary }}</text>
            <image class="arrow-icon" src="/static/svg/turn-right.svg" mode="aspectFit" />
          </view>
        </view>
      </view>
    </view>

    <!-- 注销入口：danger 语义色 -->
    <view class="actions">
      <button class="btn-deactivate" hover-class="mm-hover"
        @click="handleNavigate('/pages/profile/deactivate')">注销账号</button>
    </view>

    <!-- 上次头像确认对话框：展示上次使用的头像，用户决定是否切回 -->
    <view v-if="showPreviousAvatarDialog" class="prev-avatar-mask" @click="closePreviousAvatarDialog">
      <view class="prev-avatar-dialog" @click.stop>
        <text class="prev-avatar-title">上次使用的头像</text>
        <view class="prev-avatar-preview">
          <mm-lazy-image v-if="previousAvatarUrl" class="prev-avatar-img" :src="previousAvatarUrl"
            :thumbnail="previousAvatarThumbUrl" mode="aspectFill" />
        </view>
        <text class="prev-avatar-tip">切换后当前头像会与上次头像互换，可再次切换回来。</text>
        <view class="prev-avatar-actions">
          <button class="prev-avatar-btn" hover-class="mm-hover" :disabled="switchingPreviousAvatar"
            @click.stop="closePreviousAvatarDialog">取消</button>
          <button class="prev-avatar-btn is-primary" hover-class="mm-hover" :disabled="switchingPreviousAvatar"
            @click.stop="usePreviousAvatar">使用该头像</button>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
/* 页面容器：浅灰底 + 16px 内容边距，底部预留安全区 */
.container {
  min-height: 100vh;
  box-sizing: border-box;
  padding: var(--page-pad);
  padding-bottom: calc(var(--page-pad) + var(--safe-bottom));
  background-color: var(--bg-color);
  color: var(--text-color);
}

/* 通用卡片：白底 + 常规描边 + 12 圆角 + 卡片阴影 */
.card {
  margin-bottom: 12px;
  padding: 16px;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
}

/* 头像卡 */
.profile-header {
  position: relative;
  overflow: hidden;
  display: flex;
  justify-content: flex-end;
  flex-direction: column;
  padding: 0px;
  width: 100%;
  aspect-ratio: 1 / 1;
  /* 无背景图时的兜底底色（有头像/自定义背景时由两层 image 覆盖） */
  background-color: var(--bg-elevated);
}

/* 背景图：MmLazyImage 负责「缩略占位图 → 原图淡入」，这里只负责铺满卡片 */
.profile-bg {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.profile-bg-img {
  display: block;
  width: 100%;
  height: 100%;
}

/* 「更换背景」入口：半透明毛玻璃圆形按钮，固定在卡片右上角（不遮挡左下头像），
   不支持 backdrop-filter 时回退到 --header-bg-fallback，与全站顶栏一致 */
.bg-setting-btn {
  position: absolute;
  top: var(--page-pad);
  right: var(--page-pad);
  z-index: 3;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 50%;
  background-color: var(--header-bg-fallback);
  border: 1px solid var(--header-border);
  box-shadow: var(--card-shadow);
}

@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .bg-setting-btn {
    background-color: var(--header-bg);
    -webkit-backdrop-filter: blur(18px) saturate(180%);
    backdrop-filter: blur(18px) saturate(180%);
  }
}

/* 用 CSS 画一个「图片」小图标（外框 + 太阳 + 山），颜色跟随主题文字色 */
.bg-setting-icon {
  position: relative;
  width: 16px;
  height: 13px;
  box-sizing: border-box;
  border: 1.5px solid var(--text-color);
  border-radius: 3px;
  overflow: hidden;
}

.bg-setting-icon::before {
  content: '';
  position: absolute;
  top: 2px;
  right: 2px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background-color: var(--text-color);
}

.bg-setting-icon::after {
  content: '';
  position: absolute;
  left: 1px;
  bottom: -5px;
  width: 9px;
  height: 9px;
  box-sizing: border-box;
  border: 1.5px solid var(--text-color);
  transform: rotate(45deg);
}

.fade-bottom {
  position: relative;
  z-index: 2;
  width: 100%;
  padding: 16px;
  background: linear-gradient(to top, #ffffff 0%, #ffffff 50%, rgba(255, 255, 255, 0) 100%);
  border-radius: 0 0 var(--card-radius) var(--card-radius);
  display: flex;
  flex-direction: row;
  align-items: center;
}

/* 头像：fallback 底用主题浅底，1px 常规描边 */
.avatar-large {
  position: relative;
  width: 80px;
  height: 80px;
  margin-right: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background-color: var(--theme-color-soft);
  border: 1px solid var(--border-color);
  border-radius: 50%;
  box-shadow: var(--card-shadow);
}

.avatar-img {
  display: block;
  width: 100%;
  height: 100%;
}

/* 头像点击热区：用原生 view 承载 @click，保证小程序里点头像只预览头像、不冒泡到卡片 */
.avatar-click {
  position: relative;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
}

/* fallback 文字：主题强调色，与浅底保持对比 */
.avatar-text-large {
  font-size: 30px;
  font-weight: 600;
  color: var(--theme-color-strong);
}

.avatar-edit-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  z-index: 2;
  width: 100%;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--mask-color);
}

.edit-icon {
  margin-bottom: 2px;
  font-size: 13px;
  color: #ffffff;
}

.user-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.user-name,
.user-email {
  font-size: 13px;
  color: var(--text-muted);
}

/* 信息行 / 菜单项：分割线用 --divider-color，行高 ≥ 44px */
.list-group {
  display: flex;
  flex-direction: column;
}

.list-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 44px;
  padding: 12px 0;
  border-bottom: 1px solid var(--divider-color);
}

.list-item:last-child {
  border-bottom: none;
}

.item-label {
  font-size: 15px;
  color: var(--text-color);
}

.item-value {
  display: flex;
  align-items: center;
  gap: 6px;
}

.value-text {
  font-size: 13px;
  color: var(--text-muted);
}

/* 右侧箭头图标保持原样，降低透明度不抢视线 */
.arrow-icon {
  width: 16px;
  height: 16px;
  opacity: 0.35;
}

.actions {
  margin-top: 20px;
}

/* 注销入口：danger 语义色（浅底 + 描边 + 深红字） */
.btn-deactivate {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: var(--control-h);
  background-color: var(--color-danger-soft);
  border: 1px solid var(--color-danger);
  border-radius: 10px;
  color: var(--color-danger-text);
  font-size: 14px;
  font-weight: 500;
}

.btn-deactivate::after {
  border: none;
}

/* ===== 上次头像确认对话框 ===== */
.prev-avatar-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-color: var(--mask-color);
}

.prev-avatar-dialog {
  width: 100%;
  max-width: 320px;
  box-sizing: border-box;
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  background-color: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
}

.prev-avatar-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color);
}

.prev-avatar-preview {
  width: 180px;
  height: 180px;
  margin: 16px 0 12px;
  overflow: hidden;
  border-radius: 12px;
  background-color: var(--theme-color-soft);
}

.prev-avatar-img {
  display: block;
  width: 100%;
  height: 100%;
}

.prev-avatar-tip {
  font-size: 12px;
  line-height: 18px;
  text-align: center;
  color: var(--text-muted);
}

.prev-avatar-actions {
  display: flex;
  gap: 10px;
  width: 100%;
  margin-top: 16px;
}

.prev-avatar-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--control-h);
  padding: 0;
  margin: 0;
  background-color: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  color: var(--text-color);
  font-size: 14px;
  font-weight: 500;
  line-height: normal;
}

.prev-avatar-btn::after {
  border: none;
}

.prev-avatar-btn.is-primary {
  background-color: var(--theme-color);
  border-color: var(--theme-color);
  color: #ffffff;
}
</style>
