// 本文件用于集中配置并导出已配置好的 VMdEditor 与 VMdPreview，供需要的组件局部引入
import VMdEditor from "@kangc/v-md-editor/lib/codemirror-editor";
import "@kangc/v-md-editor/lib/style/codemirror-editor.css";
import VMdPreview from "@kangc/v-md-editor/lib/preview";
import "@kangc/v-md-editor/lib/style/preview.css";

import vuepressTheme from "@kangc/v-md-editor/lib/theme/vuepress.js";
import "@kangc/v-md-editor/lib/theme/style/vuepress.css";

import Prism from "prismjs";
import Codemirror from "codemirror";

// CodeMirror 语言与功能支持
import "codemirror/mode/markdown/markdown";      // Markdown语法
import "codemirror/mode/javascript/javascript";  // JavaScript语法
import "codemirror/mode/css/css";                // CSS语法
import "codemirror/mode/htmlmixed/htmlmixed";    // HTML语法
import "codemirror/mode/vue/vue";                // Vue语法

// CodeMirror 编辑增强
import "codemirror/addon/edit/closebrackets";    // 自动闭合括号
import "codemirror/addon/edit/closetag";         // 自动闭合标签
import "codemirror/addon/edit/matchbrackets";    // 括号匹配

// CodeMirror 显示/交互增强
import "codemirror/addon/display/placeholder";   // 占位符显示
import "codemirror/addon/selection/active-line"; // 当前行高亮

// 滚动条样式
import "codemirror/addon/scroll/simplescrollbars";
import "codemirror/addon/scroll/simplescrollbars.css";

// CodeMirror 核心样式
import "codemirror/lib/codemirror.css";

// 插件
import createLineNumbertPlugin from "@kangc/v-md-editor/lib/plugins/line-number/index";
import createCopyCodePlugin from "@kangc/v-md-editor/lib/plugins/copy-code/index";
import "@kangc/v-md-editor/lib/plugins/copy-code/copy-code.css";
import createEmojiPlugin from "@kangc/v-md-editor/lib/plugins/emoji/index";
import "@kangc/v-md-editor/lib/plugins/emoji/emoji.css";
import createTodoListPlugin from "@kangc/v-md-editor/lib/plugins/todo-list/index";
import "@kangc/v-md-editor/lib/plugins/todo-list/todo-list.css";

// 将 CodeMirror 绑定到编辑器
VMdEditor.Codemirror = Codemirror;

// 配置编辑器主题与插件
VMdEditor.use(vuepressTheme, {
    Prism,
    codeHighlightExtensionMap: {
        vue: "html",
    },
})
    .use(createLineNumbertPlugin())
    .use(createCopyCodePlugin())
    .use(createEmojiPlugin())
    .use(createTodoListPlugin());

// 配置预览组件
VMdPreview.use(vuepressTheme, {
    Prism,
    codeHighlightExtensionMap: {
        vue: "html",
    },
})
    .use(createLineNumbertPlugin())
    .use(createCopyCodePlugin())
    .use(createEmojiPlugin())
    .use(createTodoListPlugin());

export { VMdEditor, VMdPreview };
