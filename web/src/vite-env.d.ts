/// <reference types="vite/client" />
/// <reference types="vite-plugin-svg-icons/client" />

// SVG Icons virtual module declaration
declare module "virtual:svg-icons-register" {
  const register: string;
  export default register;
}
import type { ViewportBindingValue } from './directives/viewport'

declare module 'vue' {
  interface ComponentCustomProperties {
    vViewport: typeof import('./directives/viewport')['viewportDirective']
  }
}

// 扩展全局指令类型
declare module '@vue/runtime-core' {
  interface GlobalDirectives {
    viewport: (value: ViewportBindingValue) => void
  }
}

// prismjs
declare module "prismjs";