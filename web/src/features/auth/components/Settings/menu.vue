<script setup>
import SettingsMenu from "@/components/Menu/SettingsMenu.vue";
import SettingsMenuItem from "@/components/Menu/SettingsMenuItem.vue";
import ThemeColorDialog from "@/components/ThemeColorDialog.vue";
import router from "@/routers/index";
import { computed, ref } from "vue";

const menuList = ref([
    { name: "个人信息", path: "/setting/profile" },
    { name: "账号修改", path: "/setting/account" },
    { name: "头像修改", path: "/setting/avatar" },
    { name: "注销账号", path: "/setting/deactivate" },
    { name: "密码修改", path: "/setting/password" },
    { name: "平台绑定", path: "/setting/bind" },
]);

// 下拉按钮上显示当前子页名称
const menuName = computed(() => {
    const currentPath = router.currentRoute.value.path;
    const currentMenu = menuList.value.find(menu => menu.path === currentPath);
    return currentMenu ? currentMenu.name : menuList.value[0].name;
});

const handleMenuClick = (path) => {
    router.push(path);
};

const themeColorDialogVisible = ref(false);
const openThemeColorDialog = () => {
    themeColorDialogVisible.value = true;
};
</script>

<template>
    <!-- 保留原来的设置菜单（当前页名 + 汉堡 + 展开动画），
         尺寸由 SettingsMenu / SettingsMenuItem 按新顶栏（32 / 24px）收紧。 -->
    <SettingsMenu>
        <template #title>{{ menuName }}</template>
        <template #default="{ isOpen }">
            <SettingsMenuItem v-for="(value, index) in menuList" :key="value.path" :index="index" :isOpen="isOpen"
                @click="handleMenuClick(value.path)">
                {{ value.name }}
            </SettingsMenuItem>
            <SettingsMenuItem :index="menuList.length" :isOpen="isOpen" @click="openThemeColorDialog">
                <span class="theme-menu-item">
                    <span>主题色</span>
                    <span class="theme-menu-dot" aria-hidden="true"></span>
                </span>
            </SettingsMenuItem>
        </template>
    </SettingsMenu>

    <ThemeColorDialog v-model="themeColorDialogVisible" />
</template>
<style scoped lang="scss">
.theme-menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

.theme-menu-dot {
    width: 10px;
    height: 10px;
    border: 1px solid var(--theme-color-strong);
    border-radius: 50%;
    background: var(--theme-color);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--theme-color) 22%, transparent);
}
</style>
