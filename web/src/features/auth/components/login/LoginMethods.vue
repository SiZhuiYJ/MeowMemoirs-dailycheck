<script setup lang="ts">
const model = defineModel<'email' | 'account' | 'email-code'>()
</script>

<template>
    <div class="login-methods">
        <el-radio-group v-model="model" fill="#ffb3f1">
            <el-radio-button label="邮箱密码" value="email" />
            <el-radio-button label="账号密码" value="account" />
            <el-radio-button label="邮箱验证" value="email-code" />
        </el-radio-group>
    </div>
</template>

<style scoped lang="scss">
.login-methods {
    display: flex;
    margin-bottom: 16px;
    justify-content: center;
}
</style>