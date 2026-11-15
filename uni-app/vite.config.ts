import { defineConfig, loadEnv } from "vite";
import uni from "@dcloudio/vite-plugin-uni";
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // 读取 .env.[mode] / .env.[mode].local，供 H5 开发代理使用。
  // 本机开发环境可用 VITE_API_PROXY_TARGET 指向正在运行的后端
  // （见 .env.development.local，已被 .gitignore 的 *.local 忽略）。
  const env = loadEnv(mode, process.cwd(), '');
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:5210';

  return {
    plugins: [
      // @ts-ignore
      (uni.default || uni)(),
      AutoImport({
        imports: ['vue', 'pinia', 'uni-app'],
        dts: 'src/auto-imports.d.ts',
      }),
      Components({
        dts: 'src/components.d.ts',
      }),
    ],
    css: {
      preprocessorOptions: {
        scss: {
          silenceDeprecations: ['legacy-js-api'],
        }
      }
    },
    // H5 开发服务器：端口与 web 端（5173）错开；同源代理 /mm 到本机后端，
    // 这样 VITE_API_BASE_URL 留空时请求也能正确转发，且跨设备访问不会命中
    // 客户端的 127.0.0.1，同时绕开后端 CORS 白名单限制。
    server: {
      host: '0.0.0.0',
      port: 5273,
      strictPort: false,
      proxy: {
        '/mm': {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
