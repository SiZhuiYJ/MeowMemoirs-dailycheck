<script setup lang="ts">
import type { ThirdPartyBinding } from "@/features/auth/types";
import { useAuthStore } from '@/stores';
import { storeToRefs } from 'pinia'
import { authApi } from '@/features/auth/api';
import { notifySuccess, notifyError } from '@/utils/notification';
import { toLocalDateOnlyString, parseDateOnly } from "@/utils/date";
import SvgIcon from '@/components/SvgIcon/index.vue'

const authStore = useAuthStore();
const { user } = storeToRefs(authStore);

interface thirdBinds {
    name: string;// 中文名
    provider: string;// 对应编号
    icon: string;// 图标路径
    toggleBind: (bindName: string) => void;// 绑定/解绑函数
}

const loading = ref(false);

// 绑定第三方映数组
const thirdPartyBindings = ref<thirdBinds[]>([
    {
        name: '微信',
        provider: 'wechat',
        icon: 'appIcon-weixin',
        toggleBind: toggleWechatBind
    }, {
        name: '百度',
        provider: 'baidu',
        icon: 'appIcon-baidu',
        toggleBind: toggleBind
    },
    {
        name: '爱奇艺',
        provider: 'aiqiyi',
        icon: 'appIcon-aiqiyi',
        toggleBind: toggleBind
    },
    {
        name: '百度贴吧',
        provider: 'baidutieba',
        icon: 'appIcon-baidutieba',
        toggleBind: toggleBind
    },
    {
        name: '哔哩哔哩',
        provider: 'bilibili',
        icon: 'appIcon-bilibili',
        toggleBind: toggleBind
    },
    {
        name: '钉钉',
        provider: 'dingding',
        icon: 'appIcon-dingding',
        toggleBind: toggleBind
    },
    {
        name: '豆瓣网站',
        provider: 'doubanwang',
        icon: 'appIcon-doubanwang',
        toggleBind: toggleBind
    },
    {
        name: '饿了么',
        provider: 'elemo',
        icon: 'appIcon-elemo',
        toggleBind: toggleBind
    },
    {
        name: 'Facebook',
        provider: 'facebook',
        icon: 'appIcon-facebook',
        toggleBind: toggleBind
    },
    {
        name: '公众号',
        provider: 'gongzhonghao',
        icon: 'appIcon-gongzhonghao',
        toggleBind: toggleBind
    },
    {
        name: '谷歌',
        provider: 'google',
        icon: 'appIcon-google',
        toggleBind: toggleBind
    },
    {
        name: '花瓣网',
        provider: 'huabanwang',
        icon: 'appIcon-huabanwang',
        toggleBind: toggleBind
    },
    {
        name: '快手',
        provider: 'kuaishou',
        icon: 'appIcon-kuaishou',
        toggleBind: toggleBind
    },
    {
        name: '酷狗音乐',
        provider: 'kugouyinle',
        icon: 'appIcon-kugouyinle',
        toggleBind: toggleBind
    },
    {
        name: 'LinkedIn',
        provider: 'linkedin',
        icon: 'appIcon-linkedin',
        toggleBind: toggleBind
    },
    {
        name: '美团',
        provider: 'meituan',
        icon: 'appIcon-meituan',
        toggleBind: toggleBind
    },
    {
        name: '陌陌',
        provider: 'momo',
        icon: 'appIcon-momo',
        toggleBind: toggleBind
    },
    {
        name: '企业微信',
        provider: 'qiyeweixin',
        icon: 'appIcon-qiyeweixin',
        toggleBind: toggleBind
    },
    {
        name: 'QQ音乐',
        provider: 'QQyinle',
        icon: 'appIcon-QQyinle',
        toggleBind: toggleBind
    },
    {
        name: '淘宝',
        provider: 'taobao',
        icon: 'appIcon-taobao',
        toggleBind: toggleBind
    },
    {
        name: '腾讯会议',
        provider: 'tengxunhuiyi',
        icon: 'appIcon-tengxunhuiyi',
        toggleBind: toggleBind
    },
    {
        name: '腾讯QQ',
        provider: 'tengxunQQ',
        icon: 'appIcon-tengxunQQ',
        toggleBind: toggleBind
    },
    {
        name: '腾讯视频',
        provider: 'tengxunshipin',
        icon: 'appIcon-tengxunshipin',
        toggleBind: toggleBind
    },
    {
        name: '腾讯微视',
        provider: 'tengxunweishi',
        icon: 'appIcon-tengxunweishi',
        toggleBind: toggleBind
    },
    {
        name: '推特',
        provider: 'twitter',
        icon: 'appIcon-twitter',
        toggleBind: toggleBind
    },
    {
        name: '网易云音乐',
        provider: 'wangyiyunyinle',
        icon: 'appIcon-wangyiyunyinle',
        toggleBind: toggleBind
    },
    {
        name: '小红书',
        provider: 'xiaohongshu',
        icon: 'appIcon-xiaohongshu',
        toggleBind: toggleBind
    },
    {
        name: '新浪微博',
        provider: 'xinlang',
        icon: 'appIcon-xinlang',
        toggleBind: toggleBind
    },
    {
        name: 'YouTube',
        provider: 'youtube',
        icon: 'appIcon-youtube',
        toggleBind: toggleBind
    },
    {
        name: '支付宝',
        provider: 'zhifubao',
        icon: 'appIcon-zhifubao',
        toggleBind: toggleBind
    },
    {
        name: '知乎',
        provider: 'zhihu',
        icon: 'appIcon-zhihu',
        toggleBind: toggleBind
    },

]);

onMounted(async () => {
    // 获取最新的第三方绑定信息
    await fetchThirdPartyBindings();
});

// 获取第三方绑定信息
async function fetchThirdPartyBindings() {
    loading.value = true;
    try {
        const { data } = await authApi.getThirdPartyBindings();
        console.log(data)
        if (data) {
            // 更新用户信息中的第三方绑定数据
            authStore.updateUser({
                thirdPartyBindings: data.bindings
            });
        }
    } catch (error) {
        notifyError('获取第三方绑定信息失败');
        console.error('Failed to fetch third party bindings', error);
    } finally {
        loading.value = false;
    }
}

// 检查特定提供商是否已绑定
function hasProviderBind(provider: string) {
    const bindings = user.value?.thirdPartyBindings;
    // 确保bindings是数组后再调用some方法
    if (Array.isArray(bindings)) {
        return bindings.some((binding: ThirdPartyBinding) => binding.provider === provider);
    }
    return false;
}

// 获取特定提供商的绑定日期
function getBindingDate(provider: string) {
    const bindings = user.value?.thirdPartyBindings;
    // 确保bindings是数组后再调用find方法
    if (Array.isArray(bindings)) {
        const binding = bindings.find((binding: ThirdPartyBinding) => binding.provider === provider);
        return binding ? binding.boundAt : null;
    }
    return null;
}

// 处理微信绑定/解绑
async function toggleWechatBind() {
    // if (hasProviderBind('wechat')) {
    //     // 解绑微信
    //     uni.showModal({
    //         title: '确认解绑',
    //         content: '解绑后将无法使用微信一键登录，确定要解绑吗？',
    //         confirmText: '确定解绑',
    //         cancelText: '取消',
    //         success: async (modalRes) => {
    //             if (modalRes.confirm) {
    //                 try {
    //                     await http.delete('/mm/Auth/wechat/unbind');
    //                     notifySuccess('微信解绑成功');

    //                     // 更新用户信息
    //                     await authStore.fetchUserInfo();
    //                 } catch (error: any) {
    //                     console.error('解绑微信失败:', error);

    //                     if (error.statusCode === 401) {
    //                         notifyError('用户未登录或登录已过期');
    //                     } else if (error.statusCode === 404) {
    //                         notifyError('当前用户未绑定微信账号');
    //                     } else {
    //                         notifyError(error.data?.message || '解绑失败，请稍后重试');
    //                     }
    //                 }
    //             }
    //         }
    //     });
    // } else {
    //     // 绑定微信
    //     if (hasWechatEnv()) {
    //         await bindWechat();
    //     } else {
    //         notifyError('请在微信小程序环境中使用此功能');
    //     }
    // }
    // 更新绑定信息
    fetchThirdPartyBindings();
}

// 绑定微信
// async function bindWechat() {
//     try {
//         // #ifdef MP-WEIXIN
//         const loginRes: any = await new Promise((resolve, reject) => {
//             uni.login({
//                 provider: 'weixin',
//                 success: resolve,
//                 fail: reject
//             });
//         });

//         if (!loginRes.code) {
//             throw new Error('获取微信登录凭证失败');
//         }

//         await http.post('/mm/Auth/wechat/bind', {
//             code: loginRes.code
//         });

//         notifySuccess('微信绑定成功');

//         // 更新用户信息
//         await authStore.fetchUserInfo();
//         // #endif

//         // #ifndef MP-WEIXIN
//         notifyError('请在微信小程序环境中使用此功能');
//         // #endif
//     } catch (error: any) {
//         console.error('绑定微信失败:', error);

//         if (error.statusCode === 409) {
//             notifyError(error.data?.message || '绑定失败：微信账号已被绑定');
//         } else if (error.statusCode === 401) {
//             notifyError('用户未登录或登录已过期，请重新登录');
//         } else {
//             notifyError(error.data?.message || '绑定失败，请稍后重试');
//         }
//     }
// }
// 处理百度绑定/解绑
async function toggleBind(bindName: string) {
    console.log(`${bindName}绑定/解绑功能待实现`);
    notifySuccess(`${bindName}绑定功能待实现`);
    if (hasProviderBind(bindName)) {

    }
}
</script>
<template>
    <div class="setting-subpage">
        <div class="setting-card">
            <div class="setting-header">
                <h3 class="setting-title">第三方账号绑定</h3>
                <p class="setting-subtitle">管理您绑定的第三方账号，用于便捷登录。</p>
            </div>

            <div class="bind-list" v-loading="loading">
                <div class="bind-item" v-for="binding in thirdPartyBindings" :key="binding.provider">
                    <div class="bind-info">
                        <span class="bind-icon" aria-hidden="true">
                            <svg-icon :icon-class="binding.icon" size="26px" />
                        </span>
                        <div class="bind-details">
                            <span class="bind-name">{{ binding.name }}</span>
                            <span class="bind-desc">
                                {{ hasProviderBind(binding.provider) ? '已绑定，' +
                                    toLocalDateOnlyString(parseDateOnly(getBindingDate(binding.provider)!))
                                    : '未绑定' }}
                            </span>
                        </div>
                    </div>
                    <!-- <button class="bind-btn"
                        :class="hasProviderBind(binding.provider) ? 'unbind-btn' : 'bind-btn-primary'"
                        @click="binding.toggleBind(binding.name)">
                        {{ hasProviderBind(binding.provider) ? '解绑' : '绑定' }}
                    </button> -->
                    <el-button v-if="hasProviderBind(binding.provider)" type="danger" plain>
                        解绑
                    </el-button>
                    <el-button v-else type="primary" dashed>
                        绑定
                    </el-button>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped lang="scss">
@use "@/styles/responsive-mixins" as rp;

// 页面骨架见 features/setting/style/index.scss。
.bind-list {
    margin-top: 4px;
}

.bind-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 8px 6px;
    border-bottom: 1px solid var(--chat-border);
    transition: background-color 0.16s ease;

    &:last-child {
        border-bottom: none;
    }

    // 触屏上没有 hover，避免点过的行「粘」在悬停底色上
    @media (hover: hover) and (pointer: fine) {
        &:hover {
            background-color: var(--chat-surface-soft);
        }
    }

    :deep(.el-button) {
        flex-shrink: 0;
    }
}

.bind-info {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
}

// 品牌图标自带黑色路径，垫一层固定白底，夜间模式下也能看清。
// 这里的 #fff 不随主题变化是刻意的（同聊天页媒体上的白色蒙层）。
.bind-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    margin-right: 12px;
    border-radius: 10px;
    background: #fff;
}

.bind-details {
    flex: 1;
    min-width: 0;
}

.bind-name {
    display: block;
    margin-bottom: 2px;
    overflow: hidden;
    color: var(--chat-text);
    font-size: 14px;
    line-height: 20px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.bind-desc {
    display: block;
    overflow: hidden;
    color: var(--chat-muted);
    font-size: 12px;
    line-height: 18px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

@include rp.device-mobile {
    .bind-item {
        padding: 6px 2px;
    }

    .bind-icon {
        width: 36px;
        height: 36px;
        margin-right: 10px;
    }
}
</style>
