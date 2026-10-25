import { defineConfig, loadEnv } from "vite";
// 引入Vue插件
import vue from "@vitejs/plugin-vue";

// 说明：这里原本 import 了 vite-plugin-vue-devtools，但它并没有写进
// package.json（只存在于上层目录的 node_modules），干净环境里构建会直接失败。
// 它只是开发期调试工具，构建/运行性能不依赖它，因此移除。

// 引入路径别名解析插件
import path from "path";

// 引入rollup打包可视化分析插件
import { visualizer } from "rollup-plugin-visualizer";

// 引入自动导入插件和组件自动注册插件
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";

// 引入SVG图标插件
import { createSvgIconsPlugin } from "vite-plugin-svg-icons";

function getNodeModulePackageName(id: string) {
  const normalized = id.split("node_modules/")[1];
  if (!normalized) return "";
  const parts = normalized.split("/");
  if (parts[0].startsWith("@")) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0];
}

const manualChunkGroups: Record<string, ReadonlySet<string>> = {
  "vendor-office-docx": new Set(["@vue-office/docx"]),
  "vendor-office-excel": new Set(["@vue-office/excel"]),
  "vendor-office-pdf": new Set(["@vue-office/pdf"]),
  "vendor-office-pptx": new Set(["@vue-office/pptx"]),
  "vendor-ffmpeg": new Set([
    "@ffmpeg/ffmpeg",
    "@ffmpeg/util",
    "@ffmpeg/core",
    "@ffmpeg/core-mt",
  ]),
  "vendor-markdown": new Set(["@kangc/v-md-editor", "prismjs"]),
  "vendor-codemirror": new Set(["codemirror"]),
  "vendor-gsap": new Set(["gsap"]),
  "vendor-signalr": new Set(["@microsoft/signalr"]),
  "vendor-media": new Set(["mediainfo.js", "webcodecs-encoder"]),
};

function getManualChunkName(id: string) {
  if (!id.includes("node_modules")) return;

  const pkgName = getNodeModulePackageName(id);
  for (const [chunkName, packages] of Object.entries(manualChunkGroups)) {
    if (packages.has(pkgName)) {
      return chunkName;
    }
  }
}

import prismjs from "vite-plugin-prismjs";

// 定义路径别名函数（简化配置，避免重复书写）
const resolve = (dir: string) => path.resolve(__dirname, dir);
const elementPlusResolver = ElementPlusResolver({ importStyle: "css" });

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isAnalyze = env.ANALYZE === "true";
  const dropConsole = env.VITE_DROP_CONSOLE !== "false";
  const apiProxyTarget = (() => {
    const raw = env.VITE_API_BASE_URL?.trim();
    // 使用相对地址（VITE_API_BASE_URL=/）时，请求会打到 Vite 自身再走代理。
    // 这样可以显式指定本地后端（VITE_API_PROXY_TARGET），
    // 既不受本机 IP 变化影响，也不需要后端配置 CORS。
    if (!raw || raw === "/") return env.VITE_API_PROXY_TARGET?.trim() || "https://8.137.127.7";

    try {
      return new URL(raw).origin;
    } catch {
      return raw.replace(/\/+$/, "");
    }
  })();
  const apiProxyHeaders =
    apiProxyTarget === "https://8.137.127.7"
      ? {
        host: "check.meowmemoirs.cn",
      }
      : undefined;

  return {
    plugins: [
      // 引入Vue插件
      vue(),
      // PrismJS插件，用于代码高亮
      prismjs({
        languages: ["json", "bash", "typescript", "css", "sql", "javascript"],
      }),

      // 自动导入插件，自动导入Vue和Pinia相关函数，并自动注册Element Plus组件
      AutoImport({
        imports: ["vue", "pinia"],
        resolvers: [elementPlusResolver],
        dts: "src/auto-imports.d.ts",
      }),
      // 组件自动注册插件，自动注册Element Plus组件
      Components({
        resolvers: [elementPlusResolver],
        dts: "src/components.d.ts",
      }),
      // SVG图标插件，用于处理SVG雪碧图
      createSvgIconsPlugin({
        // 指定存放SVG图标的目录
        iconDirs: [path.resolve(__dirname, "src/assets/icons")],
        // 生成 symbol ID 格式
        symbolId: "icon-[dir]-[name]",
      }),
      ...(isAnalyze
        ? [
          visualizer({
            filename: "stats.html", // 分析报告生成的文件名和路径
            open: true, // 构建完成后自动在浏览器中打开报告
            gzipSize: true, // 显示 gzip 压缩后的大小
            brotliSize: true, // 显示 brotli 压缩后的大小
            emitFile: true, // 如果为 false，则不会生成文件，只在控制台输出
          }),
        ]
        : []),
    ],
    optimizeDeps: {
      // npm install @ffmpeg/ffmpeg @ffmpeg/util @ffmpeg/core-mt
      exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
    },
    // 开发服务器配置
    server: {
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin", // 保护你的源站点免受攻击
        "Cross-Origin-Embedder-Policy": "require-corp", // 保护受害者免受你的源站点的影响
      },
      host: '0.0.0.0', // 设置服务器监听所有网络接口
      proxy: {
        "/mm": {
          target: apiProxyTarget,
          headers: apiProxyHeaders,
          //* 忽略https证书错误 */
          changeOrigin: true,
          // 允许代理服务器使用自签名证书
          secure: false,
        },
        "/hubs/chat": {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
          ws: true,
        },
      },
      watch: {
        usePolling: true, // 启用轮询
        interval: 100, // 轮询间隔（毫秒）
      },
    },
    /**
     * 构建配置
     */
    build: {
      // 静态资源体积限制（超过该大小的资源会单独打包，单位：kb）
      assetsInlineLimit: 4096, // 4kb，常用配置
      // 打包时删除输出目录（避免旧产物残留，规范）
      emptyOutDir: true,
      // 说明：Vite 没有 build.compression 选项（旧配置写在这里也不会生效）。
      // 预压缩交给部署层（Nginx gzip_static / CDN），HTTP 响应的压缩由后端
      // ResponseCompression 中间件负责；这里只保留真正生效的构建参数。
      cssCodeSplit: true, // 保持CSS分包
      rollupOptions: {
        output: {
          chunkFileNames: "js/[name]-[hash].js", // 引入文件名的名称
          entryFileNames: "js/[name]-[hash].js", // 包的入口文件名称
          assetFileNames: "[ext]/[name]-[hash].[ext]", // 资源文件像 字体，图片等

          manualChunks(id) {
            if (!id.includes("node_modules")) return;

            // 重型可选依赖（office / ffmpeg / markdown / gsap …）按显式分组各自成 chunk，
            // 由路由的动态 import 按需拉取。
            const grouped = getManualChunkName(id);
            if (grouped) return grouped;

            // Vue 运行时单独成 chunk：它被几乎所有路由共享，独立出来既能长期缓存，
            // 也避免 Rollup 把它并进「第一个用到它的业务 chunk」。
            // （旧实现分组后立刻 return，Vue 被并进 vendor-office-docx，
            //  index.html 每次首屏都预加载 374KB 的 docx。）
            const pkgName = getNodeModulePackageName(id);
            if (
              pkgName === "vue" ||
              pkgName === "vue-router" ||
              pkgName === "pinia" ||
              pkgName.startsWith("@vue/") ||
              pkgName === "axios"
            ) {
              return "vendor-vue";
            }

            // 其余交给 Rollup 默认分包：Element Plus 走按需引入，
            // 强行合并成一个巨大 vendor chunk 反而会拖慢首屏。
          }
        },
      },
      // 提升告警阈值，避免对已合理拆分的 vendor 包持续误报
      chunkSizeWarningLimit: 850,
      minify: "terser", // 启用 terser 压缩
      terserOptions: {
        compress: {
          // 生产环境默认移除 console/debugger，必要时可通过 VITE_DROP_CONSOLE=false 关闭
          drop_console: dropConsole,
          drop_debugger: dropConsole,
        },
      },

    },
    esbuild: {
      // 删除 所有的console 和 debugger
      // drop: ["console", "debugger"],
    },
    /* ========================== 路径别名配置（工程化必备） ========================== */
    resolve: {
      // 路径别名（解决长相对路径问题，与 tsconfig.json 保持一致）
      alias: {
        '@': resolve('src'), // 核心别名：@ 指向 src 根目录（标准）
        '@/components': resolve('src/components'), // 组件目录
        '@/utils': resolve('src/utils'), // 工具函数目录
        '@/api': resolve('src/api'), // 接口请求目录
        '@/types': resolve('src/types'), // TypeScript 类型声明目录
        '@/assets': resolve('src/assets'), // 静态资源目录
        '@/store': resolve('src/store'), // 状态管理目录（Pinia）
        '@/router': resolve('src/router'), // 路由目录
      },
      // 省略文件后缀（简化导入，常用配置）
      extensions: ['.ts', '.tsx', '.vue', '.js', '.jsx', '.json', '.scss'],
    },
  };
});
