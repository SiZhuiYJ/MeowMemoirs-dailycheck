declare module "@kangc/v-md-editor/lib/preview";
declare module "@kangc/v-md-editor/lib/plugins/line-number/index";
declare module "@kangc/v-md-editor/lib/plugins/copy-code/index";
declare module "@kangc/v-md-editor/lib/plugins/emoji/index";
declare module "@kangc/v-md-editor/lib/plugins/todo-list/index";
declare module "@kangc/v-md-editor/lib/theme/vuepress.js";
declare module "codemirror";

declare module "@kangc/v-md-editor/lib/codemirror-editor" {
  import { DefineComponent } from "vue";

  interface VMdEditorInstance {
    [key: string]: any;
  }

  const component: VMdEditorInstance &
    DefineComponent<{}, {}, any> & { install: (app: any) => void };
  export default component;

  export const Codemirror: any;
  export function use(theme: any, options?: any): void;
}
