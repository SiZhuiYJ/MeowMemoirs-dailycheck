<script setup lang="ts">
import { onMounted } from 'vue'
import { generateRandomString } from '@/utils/string'

const APPID = '你自己注册的网站应用开发的APPID 在上图中绑定成功的网站应用，点击查看即可查看'

let redirectUri = encodeURIComponent(`${location.protocol}//${location.host}/echo#/login`)
const isDev = import.meta.env.DEV
if (isDev)
    redirectUri = encodeURIComponent('https://xxxx(这个里面写网站应用开发里面配置的授权回调域)/你自己要跳转到页面')

const state = generateRandomString() // 这个自己写一个生成随机字符串的函数，只要是唯一的什么都可以，uuid 随机数。。。

onMounted(() => {
    // eslint-disable-next-line no-new   // 不添加这个会报错
    new WxLogin({
        // true：手机点击确认登录后可以在 iframe 内跳转到 redirect_uri，false：手机点击确认登录后可以在 top window 跳转到 redirect_uri。默认为 false
        self_redirect: false,
        id: 'login_container',
        appid: APPID,
        scope: 'snsapi_login',
        redirect_uri: redirectUri,
        state,
        style: 'black',
    })
})
</script>

<template>
    <div class="layout-login">
        <div id="login_container"></div>
    </div>
</template>
