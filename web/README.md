# 喵咪记事簿 · Web 前端

`Vue 3` + `TypeScript` + `Vite` + `Element Plus` + `Pinia`。

```bash
npm install
npm run dev      # 开发服务器，默认 http://localhost:5173
npm run build    # vue-tsc -b 类型检查 + vite build
```

接口地址由 `.env.development` 的 `VITE_API_BASE_URL` 决定。

---

## Miku 光标（内置动画指针）

`src/libs/mikuCursor/` 用 Miku 主题的 `.ani` 动画指针替换系统光标。`src/assets/Miku/*.ani`
是**源文件**，运行时不再解析它们；构建期由脚本拆成帧与动画信息：

```bash
npm run cursors   # 重新生成帧图 + cursors.generated.ts
```

产物（已提交，改完 `.ani` 记得重跑）：

| 路径 | 内容 |
| --- | --- |
| `public/miku-cursors/<cursor>/<frame>.png` | 32×32 帧图；首帧由元数据 `steps[0]` 指定（本批素材都是 `0.png`） |
| `src/libs/mikuCursor/cursors.generated.ts` | 每帧时长、总时长、准星（热点）、内容版本号（别手改） |

运行时分两步：

1. **启动**：只给每只光标装首帧（单帧动画）并预热首帧图片 —— 首屏就有 Miku 光标，
   不用等 146 帧全部下载；
2. **空闲**：`requestIdleCallback` 里逐只光标加载剩余帧，加载完把同一条 `<style>` 换成完整
   `@keyframes`，光标开始动。

光标**准星**也来自素材：ANI 每帧 CUR 头里的 hotspot，生成时按 `32 / 原始尺寸` 换算，
不要在手写热点里调 —— 写错会让整只光标（比如按钮上的 Link）整体偏移。

帧图放 `public/` 是为了「用到哪张才请求哪张」（放 `src/assets` 会被打进模块图，dev 启动
多 146 个请求）；`?v=<版本号>` 负责缓存失效。选择器白名单在 `src/libs/mikuCursor/index.ts`
的 `CURSOR_RULES`：新增「整块可点」的自定义元素（不是 `<button>`/`<a>`）时，把选择器补到
`appInteractiveSelectors`，否则它会因为自己的 `cursor: pointer` 掉回系统光标。

---

## 主题切换（日间 / 夜间）与主题色自定义

默认主题色（种子色）是 **`#e3c0df`**，以 `src/config/index.ts` 的 `DEFAULT_THEME` 为准。
用户可以在聊天页「更多」或用户信息下拉点「主题色」，打开
`ThemeColorDialog` 对话框调整：

- 预设色点 / 原生取色器 / 恢复默认；
- 取色后实时生成整套色阶，写入 `<html>` 行内 CSS 变量；
- 颜色切换带 **500ms** 全局颜色过渡（`theme-color-transitioning`），不播整页波纹；
- 种子色存 `localStorage.themeColor`，日夜模式存 `localStorage.theme`；
- 刷新后 `index.html` 首屏脚本先写回种子色，`use-theme.ts` 再补齐完整色阶。

色阶由 `src/composables/theme-palette.ts` 从种子色的 HSL 推导：日间压深强调色、
加白浅底、深色动作按钮；夜间提亮强调色、半透明浅底、暗色动作按钮；
Element Plus primary 的 light-3/5/7/8/9 / dark-2 也同步生成。
`src/styles/theme-colors.scss` 保留默认色的首屏兜底。

默认种子色生成的近似值：

| 变量 | 日间 | 夜间 | 用途 |
| --- | --- | --- | --- |
| `--theme-color` | `#e3c0df` | `#e3c0df` | 种子色：波纹、浅色底、装饰 |
| `--theme-color-strong` | `#9b4f93` | `#e3c0df` | 可读强调：链接、文字、焦点、描边 |
| `--theme-color-deep` | `#783a71` | `#e9cfe6` | hover / active |
| `--theme-color-soft` | `#f7e9f5` | 半透明主题色 | 选中态、tag、浅底 |
| `--theme-color-contrast` | `#2b1428` | `#2b1428` | 种子色 / 浅色底上的文字 |
| `--theme-primary-bg` | `#e3c0df` | `#e3c0df` | 浅色主题底（次级按钮 / 展示块） |
| `--theme-primary-hover` | `#d6a4d1` | `#e9cee6` | 浅底 hover |
| `--theme-action-bg` | `#9b4f93` | `#7f627c` | 深色动作按钮底（主操作） |
| `--theme-action-contrast` | `#ffffff` | `#ffffff` | 深色动作按钮文字（白） |
| `--theme-gradient` | 深梅 → 暗梅 | 同左 | 登录 / 确认按钮渐变 |

深色动作按钮的底色是种子的深色变体（不是 `#e3c0df` 本身）：
白字落在 `#e3c0df` 上只有 1.6:1 对比度，落在 `--theme-action-bg` 上约 5.4:1。
浅色底上的文字由 `theme-palette.ts` 的 `pickOnColor()` 按 WCAG 对比度自动挑白 / 深梅色；
当前种子色会挑深梅色，主题色变深时自动切白。

Element Plus 的 primary 也映射到同一色板：日间 `--el-color-primary: #9b4f93`，
夜间回到种子色；实心 primary 按钮统一用 `--theme-action-bg` + 白字，
plain / link 版本仍用浅底 + 可读强调色字。success / warning / danger 等语义色保持
Element Plus 默认值，不参与主题色替换。

> 聊天页是固定的浅色面，`useLightSurface()` 会给 `<html>` 挂 `.theme-light-surface`，
> 并让主题色始终取**日间色阶**的 `--theme-color-strong` / `--theme-color-soft`
> 作为 `--chat-accent` / `--chat-accent-soft`；离开聊天页后恢复当前日夜模式的色阶。

切换入口：

- **日 / 夜**：顶栏太阳 / 月亮按钮（`toggleTheme()`，带波纹动画）；
- **主题色**：聊天页「更多」、用户信息下拉的「主题色」按钮 → 对话框
  （`setThemeColor()` / `resetThemeColor()`，取色时 500ms 颜色过渡，
  不播整页动画）。

日 / 夜切换点击后不是全局瞬间换色，而是以**视口中心**为圆心扩散一圈环形波纹：

1. 支持 View Transitions 的浏览器（Chrome / Edge / Safari 18+ 等）：
   旧、新主题各拍一张快照，新的那张按 `circle()` 从圆心向外揭开；
   波纹环是一个独立的 `view-transition-name: theme-ripple` 组，
   由 `theme-ripple-ring` 关键帧从圆心放大到视口对角线，并带主题色描边与发光。
   整页文字、面板、背景都会随波纹一起更新，不只是背景色。
2. 不支持时：给 `<html>` 临时挂 `.theme-colors-transitioning`，
   对颜色相关属性做 720ms transition；同一枚波纹退化为真实 DOM 元素播放缩放动画。
3. 系统开启 `prefers-reduced-motion: reduce` 时，程序化 `setTheme` 默认直接生效；
   但顶栏按钮是用户主动点击的明确反馈，`toggleTheme` 会 `force` 播放波纹，
   避免出现「点了按钮却只是瞬切」的无反馈状态。

### 按钮统一规则

| 场景 | 写法 | 颜色 |
| --- | --- | --- |
| 主操作（发送 / 保存 / 确认 / 新建） | `type="primary"` 或 action token | 深色主题变体底 + 白字 |
| 次级 / 取消 / 返回 | 不写 `type` | 主题浅底 + 可读强调色字 |
| 文字 / 链接操作 | `link` / `text` | 透明底 + 可读强调色字 |
| 危险操作（删除 / 撤回 / 解散） | `type="danger"` | Element Plus 红色语义（故意不主题化） |
| 成功 / 警告（审批 / 禁言） | `type="success"` / `warning` | Element Plus 语义色 |

- 主按钮（含 `.create`）使用 `--theme-action-bg` / `--theme-action-contrast`；
  浅色主题底仍用 `--theme-color-soft` / `--theme-color-strong`。
- **不要再给 `el-button` 写 `color="#111827"` 之类的硬编码颜色**：
  它会生成内联 CSS 变量，覆盖全局主题规则。需要实心主按钮就写 `type="primary"`。
- 聊天页 / 用户主页是固定浅色面：挂载时给 `<html>` 加 `.theme-light-surface`，
  连同 Element Plus 的基础变量、语义色一起切到浅色。这样 Teleport 到 body 的
  聊天弹窗、下拉层也拿到正确色板，不会在夜间模式下变成「浅粉字 + 深色底」。
- 设置菜单、聊天操作行、文件预览工具栏等原生 `<button>` 也统一引用主题变量；
  语义型的危险 / 警告按钮保留红 / 黄。

| 文件 | 作用 |
| --- | --- |
| `src/composables/use-theme.ts` | 主题状态、localStorage、View Transition / 降级动画、快速连点合并 |
| `src/styles/theme-colors.scss` | 全局主题色板 + Element Plus 按钮 / 表单控件 / 固定浅色面覆盖 |
| `src/styles/theme-transition.scss` | 圆形揭开、波纹环、降级颜色过渡 |
| `index.html` | 首屏内联脚本，先写 `data-theme` / `.dark`，避免夜间用户先闪一帧日间 |
| `tools/dev-verify/verify-theme-transition.mjs` | 真实 chromium 验证色板、两条动画路径、快速连点与减少动态效果 |

> 波纹的结束半径会按视口对角线换算成 `circle()` 的百分比写进
> `--theme-ripple-end-radius`，保证「揭开的圆边」和「波纹环」始终重合。
> 改动画时长时改 `use-theme.ts` 的 `THEME_TRANSITION_MS`（CSS 会读取同一个值）。

---

## 响应式适配约定（重要）

### 判定规则：横屏一律桌面，竖屏按宽度

| 视口 | 尺寸 | 方向 | 布局 |
| --- | --- | --- | --- |
| 手机竖屏 iPhone 15 | 393×852 | 竖屏 | 手机 |
| 手机横屏 iPhone 15 | 852×393 | 横屏 | **桌面** |
| 手机横屏 iPhone SE | 667×375 | 横屏 | **桌面** |
| 竖屏平板 iPad | 820×1180 | 竖屏 | 桌面（宽 820 > 768） |
| 桌面窗口被拉窄 | 700×1200 | 竖屏 | 手机（宽 700 ≤ 768） |
| 被拖扁的电脑窗口 | 700×400 | 横屏 | 桌面 |

展开成两条：

1. **横屏（`width > height`）→ 桌面**。横过来之后横向空间足够放下桌面那套结构
   （例如聊天的 300px 会话列表 + 消息面板），继续用手机的单栏结构反而浪费宽度。
2. **竖屏 → 按宽度**：`width <= 768` 走手机布局，否则桌面。
   竖屏下必须「宽度满足手机像素宽度」才算手机 —— 820×1180 的竖屏平板虽然「高 > 宽」，
   但宽度不是手机像素宽度，仍然走桌面布局。

> **所以宽高比在这里的作用是「保护横屏」**：只要横过来就一直用桌面布局，
> 不会因为宽 667 就被打回手机单栏。
>
> 注意「横屏一律桌面」意味着电脑窗口被拖成又扁又窄（700×400 这类）时也是桌面布局。

### `layout` 与 `isPhone` 是两个概念

| 概念 | 含义 | 谁在用 |
| --- | --- | --- |
| `layout` | 该用哪套**结构**（mobile / desktop） | 组件结构切换、`.desktop-only` / `.mobile-only` |
| `isPhone` | 几何上**是不是手机** | 埋点诊断、`data-phone`、与输入方式相关的微调 |
| **`tier`** | **设备档位（手机 / 平板 / 大屏电脑）** | **聊天页结构 + 控件密度，见下一节** |

横屏手机是 `layout: desktop` + `isPhone: true`；700×1200 的窄窗口是
`layout: mobile` + `isPhone: false`。**`isPhone` 不参与布局切换。**

### 三档设备（聊天页 / `/chat`）

正常情况只分三档，**只看宽度**：

| 档位 | 判据 | 聊天页结构 | 控件高度 / 间距 |
| --- | --- | --- | --- |
| **大屏电脑端** | 宽 `> 1200` | 双栏（会话列表 + 聊天界面）—— 常规布局 | 32px / 12px |
| **平板端** | `600 ~ 1200`，**或** 宽 `<= 600` 且 宽/高 `>= 1.5` | **双栏，两个界面一起展示** | **24px / 6px** |
| **手机端** | 宽 `<= 600` 且 宽/高 `<= 1.499`（不够扁） | **单栏，只展示一个界面**（会话列表 / 聊天界面二选一） | **24px / 6px** |

> **「宽度虽小但够扁」也走双栏**：屏幕再小，只要宽高比够（3:2 起，手机横屏都在 1.5~2.2），
> 横向就放得下两栏，挤成单栏反而浪费宽度、还多一次来回点击。
> 这一类归到平板档（双栏 + 24px/6px），聊天页会把侧栏收窄到 `clamp(110px, 34%, 200px)`。

| 视口 | 宽度×高度 | 宽/高 | 档位 | 结构 |
| --- | --- | --- | --- | --- |
| iPhone 15 竖屏 | 393×852 | 0.46 | 手机 | 单栏 |
| iPhone SE 横屏 | 667×375 | 1.78 | 平板 | 双栏 |
| 小屏手机横屏 | 480×320 | 1.50 | 平板 | **双栏** |
| 手机横屏（iPhone SE 1 代） | 568×320 | 1.78 | 平板 | **双栏** |
| 小窗口（4:3 附近） | 500×360 | 1.39 | 手机 | 单栏 |
| 手机横屏 iPhone 15 | 852×393 | 2.17 | 平板 | 双栏 |
| iPad mini 竖屏 | 768×1024 | 0.75 | 平板 | 双栏 |
| iPad 竖屏 | 820×1180 | 0.69 | 平板 | 双栏 |
| iPad 横屏 | 1180×820 | 1.44 | 平板 | 双栏 |
| 笔记本 | 1366×768 | 1.78 | 大屏电脑 | 双栏 |
| 桌面 | 1920×1080 | 1.78 | 大屏电脑 | 双栏 |

这条宽高比分支的阈值是 `$bp-split-aspect: 1.499`（SCSS）/ `splitAspectRatio: 1.499`（TS），
有效阈值 3:2。取 1.499 而不是 1.5 的原因：媒体查询的 `max-aspect-ratio` 是**闭区间**，
无法表达「严格小于」，所以单栏用 `max-aspect-ratio: 1.499`、双栏用 `min-aspect-ratio: 1.5`，
两侧严格互补（TS 用 `宽/高 > 1.499` 与之一一对应）。

为什么另一条轴（`layout`）的分界是 768、而档位的分界是 600/1200：
两者解决的问题不同 —— `layout` 管「老页面该切哪套结构」，档位管
「横向空间够不够放两栏 / 够不够摆大间距」。竖屏平板最窄的 iPad mini 是 768，
必须落到平板档（双栏），不能被当成手机。

| 文件 | 用途 |
| --- | --- |
| `src/utils/device-layout.ts` | `classifyViewport().tier`（纯函数）+ `DEVICE_LAYOUT_BREAKPOINTS.phoneMaxWidth / pcWidth / splitAspectRatio` |
| `src/styles/responsive-mixins.scss` | `$bp-phone-max` / `$bp-pc` / `$bp-split-aspect` + `device-phone` / `device-small-landscape` / `device-tablet` / `device-desktop` / `device-mobile` |
| `src/composables/use-device-layout.ts` | `useDeviceLayout().tier / isPhoneTier / isTabletTier / isDesktopTier / isSmallLandscape`，并写 `<html data-device="phone|tablet|desktop">` |

聊天页三档只改 `.chat-page` 上的这几个变量，结构差异单独写：

```scss
.chat-page {
  // 大屏电脑端（默认）
  --chat-gap: 12px;        // 块间距
  --chat-pad: 12px;        // 面板内边距
  --chat-control-h: 32px;  // 按钮 / 输入框 / 下拉框统一高度
}

// 手机 + 平板：24px 控件 + 6px 间距（只写这一处）
@include rp.device-mobile {
  .chat-page {
    --chat-gap: 6px;
    --chat-pad: 6px;
    --chat-control-h: 24px;
  }
}

// 手机：单栏（平板不用写，保持默认双栏）
// 注意 device-phone 自带「不够扁」守卫，手机横屏不会命中这里
@include rp.device-phone {
  .layout { grid-template-columns: minmax(0, 1fr); }
}

// 宽扁小屏（手机横屏）：仍是双栏，但侧栏要收窄
@include rp.device-small-landscape {
  .layout { grid-template-columns: clamp(110px, 34%, 200px) minmax(0, 1fr); }
}
```

> **EP 控件高度必须逐个接管**：`.el-button` 写死 32px、`.el-button--small` 写死 24px、
> `.el-select__wrapper` 写死 `min-height: 32px` —— 它们都不读 `--el-component-size`。
> 聊天页把它们统一挂到 `var(--chat-control-h)` 上（见 `features/chat/style/index.scss`），
> 否则会出现「输入框 24px、按钮 32px、下拉框 32px」的错位。


### 聊天弹层（`ChatDialog`）

聊天页里的弹层（会话详情 / 邀请成员 / 加群申请 / 禁言 / 好友列表 / 搜索好友 /
好友申请 / 黑名单 / 申请加入群聊 / 拖拽上传确认 / 文件详情）统一使用
`src/features/chat/components/ChatDialog.vue`，**不再使用 `el-dialog` / `el-drawer`**。

它把聊天主界面的布局直接搬进弹层（整屏、三层）：

```text
.chat-dialog-overlay                 遮罩（fixed，跟随 --app-h）
  └ .chat-dialog.conversation-detail 面板：100% 宽高（max 100vw / --app-h）
      ├ .chat-header                 顶部栏（标题 + header-actions + 关闭）
      ├ .el-scrollbar                中间内容栏（唯一滚动区，宽高 100%）
      │   └ .chat-dialog-body        内容列（居中，max-width 默认 760px）
      └ .composer                    底部栏（仅当传入 #footer 时渲染）
```

| 要点 | 规则 |
| --- | --- |
| 尺寸 | 面板宽高均为窗口的 100%，`max-width: 100vw`、`max-height: var(--app-h, 100dvh)`；中间 `.el-scrollbar` 同样是 100% / 100% |
| 顶部 / 底部栏 | 绝对定位 + 毛玻璃渐变，沿用聊天页 `.chat-header` / `.composer` 的视觉；内容从它们下面滚过去 |
| 内容宽度 | `content-width` 控制内容列（`760px` / `720px` / `640px` / …），只影响内容，不影响滚动区铺满窗口 |
| 三档密度 | 大屏 32px 控件 / 12px 间距；平板·手机 24px / 6px（`device-mobile`），与聊天页同一套变量 |
| 安全区 | 顶部、底部、左右都叠加 `--safe-*`，刘海屏 / 手势条不会压住标题和按钮 |
| 层级 | 基准 z-index `1900`（低于 Element Plus 的 2000 档，`ElMessageBox.confirm` 与下拉框才能浮在上面）；嵌套弹层按打开顺序每层 +10 |
| 滚动 | 弹层里只有 `.chat-dialog-scrollbar` 一个滚动区；调用方的长列表**不要再套 `el-scrollbar`**，成员列表 / 拖拽文件列表的内层 `max-height + overflow` 也一并去掉 |
| 交互 | 打开锁 body 滚动（嵌套用计数）；ESC 只关最上层；Tab 焦圈限制在面板内，关闭后焦点还原到打开前元素 |
| 事件 | `update:modelValue` / `open` / `opened` / `close` / `closed`；`closed` 在过渡结束后触发，与原 `el-dialog` 的 `@closed` 语义一致 |
| 忙碌态 | `closable` 是总开关（关闭按钮 / 遮罩 / ESC）；`show-close`、`close-on-click-modal`、`close-on-press-escape` 与原 `el-dialog` 同名同义 |

示例：

```vue
<ChatDialog v-model="visible" title="好友列表" content-width="640px"
  @closed="reset">
  <!-- 长列表直接铺开，交给弹层的唯一滚动区 -->
  <div v-for="item in items" :key="item.id">…</div>

  <template #footer>
    <el-button @click="visible = false">关闭</el-button>
  </template>
</ChatDialog>
```

> `ChatDialog` 自己 Teleport 到 `body`，调用方不要在外面再包一层 `<Teleport>`。

### 规则实现在哪

| 文件 | 用途 |
| --- | --- |
| `src/utils/device-layout.ts` | JS 判定（`classifyViewport()` 是纯函数）—— 含 `layout`（两档）与 `tier`（三档） |
| `src/styles/responsive-mixins.scss` | CSS 判定（`$bp-*` 常量 + mixin） |
| `src/composables/use-device-layout.ts` | 把判定写到 `<html>`：`data-layout` / `data-device` / `data-short` … 与 `--app-*` 变量 |

两边**必须同步修改**。`tools/dev-verify/verify-device-layout.mjs` 会校验一致性
（断点常量漂移、全矩阵判定、`@mixin desktop` 是否为 `@mixin phone` 的严格取反、
`@mixin phone` 有没有带 `orientation: portrait`、**`tier` 与 `device-*` mixin 的全矩阵比对**、
以及聊天页三档的关键声明）；`verify-device-layout-dom.mjs` 再校验
「判定结果 → `<html>` 属性 / CSS 变量」这段契约（含 `data-device`）。
这两个都不需要后端，改完响应式相关代码跑一下：

```bash
node tools/dev-verify/verify-device-layout.mjs
node tools/dev-verify/verify-device-layout-dom.mjs
```

想在**真实浏览器**里确认「控件真的 24px、平板真的并排两栏」，再跑一个
（需要 dev server + chromium，缺条件会自动 SKIP）：

```bash
node tools/dev-verify/verify-chat-layout.mjs
```

### 写响应式样式

**优先用 `responsive-mixins.scss` 的 mixin，不要写裸 `@media (max-width: 768px)`**，
否则横屏手机（宽 852）会漏掉。

**两条轴要分清** —— 这是最容易混的地方：

| 轴 | 管什么 | 用什么 |
| --- | --- | --- |
| **布局结构** | 桌面双栏 / 手机单栏 | `rp.phone` / `rp.desktop`、`.desktop-only` / `.mobile-only` |
| **设备档位** | 大屏电脑 / 平板 / 手机（三档） | `rp.device-desktop` / `rp.device-tablet` / `rp.device-phone`（+ `rp.device-mobile`） |
| **紧凑密度** | 间距、字号、内外边距 | `rp.compact($max)` / `rp.short-viewport` |

横屏手机（852×393）在旧轴上属「**桌面结构 + 小屏密度**」；在三档轴上它是
**平板档**（双栏 + 24px / 6px）。聊天页已全部改用三档轴，老页面继续用旧轴。

```scss
<style scoped lang="scss">
@use "@/styles/responsive-mixins" as rp;

.panel {
  padding: 16px;

  // 布局结构：手机布局 = 竖屏 且 宽 <= 768（横屏一律不命中）
  @include rp.phone {
    grid-template-columns: 1fr;
  }

  // 设备档位（聊天页用法）：手机单栏、平板双栏、移动端统一 24px 控件
  @include rp.device-phone { grid-template-columns: minmax(0, 1fr); }
  @include rp.device-mobile { --chat-control-h: 24px; }

  // 紧凑密度：宽 <= 768 或 视口高 <= 560 —— 横屏手机走这里
  @include rp.compact(768px) {
    padding: 8px;
    gap: 8px;
    font-size: 13px;
  }

  @include rp.phone-portrait { /* 竖屏 且 宽 <= 480 */ }
  @include rp.short-viewport { /* 只针对「矮」（高 <= 560），不波及窄而高的视口 */ }
  @include rp.coarse-pointer { /* 触屏：放大点击区域、去掉粘滞 hover */ }
  @include rp.fine-pointer { /* 鼠标：悬停效果只在鼠标端生效 */ }
  @include rp.landscape { /* 仅横屏 */ }
  @include rp.desktop { /* 明确只在桌面（phone 的严格取反） */ }
}
</style>
```

### 侧栏宽度用占比，不要写死 px

小窗口下写死宽度会吃掉太多横向空间（聊天 300px / 852 宽 = 35%）。
用 `clamp(下限, 占比, 上限)`，大屏观感不变、小屏自动收窄：

```scss
// 聊天会话列表：1920 -> 300px，852 -> 约 248px，667 -> 约 193px
grid-template-columns: clamp(180px, 30%, 300px) minmax(0, 1fr);
// 计划页侧栏：1200 -> 260px，852 -> 约 187px
grid-template-columns: clamp(150px, 22%, 260px) minmax(0, 1fr);
```

### 小窗口：桌面布局也要用紧凑密度

**布局结构**和**紧凑密度**是两条独立的轴，小窗口是最容易搞错的地方：

| 视口 | 布局 | 密度 |
| --- | --- | --- |
| 1600×1000 | 桌面 | 常规 |
| **900×700** | **桌面** | **紧凑** ← 桌面结构要 ~1024px 才舒展 |
| 852×393（手机横屏） | 桌面 | 紧凑（且过矮） |
| 393×852（手机竖屏） | 手机 | 紧凑 |

判定常量是 `$bp-small-window: 1024px`（SCSS）/ `smallWindowWidth`（TS），
对应 `html[data-compact="true"]` 与 `useDeviceLayout().isSmallWindow`：

```scss
// 只改间距/字号/内边距，不动布局结构
@include rp.compact(rp.$bp-small-window) {   // 宽 <= 1024 或 高 <= 560
  .chat-page { padding: 8px; gap: 8px; }
}
```

> 聊天页已改成更精细的**三档**（600 / 1200，见上文「三档设备」）：
> 手机与平板统一 24px 控件 + 6px 间距，大屏电脑端才用常规密度。
> 900×700 这类窗口现在落在平板档（双栏 + 24px/6px），
> 不再依赖 `rp.compact` 收间距 —— 但 `.plans` 等老页面仍然用它。

### 会话列表：宽度自适应与溢出坑

列表列只有 180–300px，所以它内部的一切都随**列表自身宽度**缩（容器查询，
`cqi` = 容器内容宽的 1%），而不是看视口：

| 项 | 宽列表 | 窄列表 |
| --- | --- | --- |
| `li` 内边距 / 列内间距 | 12px | **6px** |
| 头像 | 60px | 36px |
| 会话名 / 预览字号 | 13px | 11px |
| 时间字号 | 11px | 10px |

> **溢出的根因有两层，缺一层都修不掉：**
>
> **第一层：`li` 自己（grid item）溢出父元素。**
> `ul.conversation-list` 是 `display: grid` 但没声明 `grid-template-columns`，
> 于是是隐式 `auto` 轨道；`auto` 轨道的基准尺寸取列表项的 **min-content**，
> 而会话名是 `nowrap`，其 min-content 就等于整条标题宽度 —— 轨道被撑到比 `ul`
> 内容区还宽。实测：父 `<aside>` 宽 200px、`ul` 内容区 182.67px 时，`li` 量到 **203.69px**。
>
> 修法（两条都留着，互为保险）：
> ```scss
> .conversation-list { grid-template-columns: minmax(0, 1fr); }  // 轨道下限显式压到 0
> .conversation-list li { min-width: 0; }                        // grid item 可收缩
> ```
> 注意：**只给 `li` 内部的 `.item` 加 `min-width: 0` 是没用的** —— 溢出的是 `li` 自己。
>
> **第二层：`li` 内部的 `.item`（`el-badge` 根元素）。**
> EP 的 `.el-badge` 是 `width: fit-content`（`fit-content = max(min-content, 可用宽度)`），
> 靠 `width` 去覆盖它不稳（同特异性，看打包顺序）。正确做法是
> **`flex: 1 1 0%` + `min-width: 0`**：flex 子项的主轴尺寸优先取 `flex-basis`，
> `width` 根本不参与计算，与 EP 谁在前面无关。另加 `overflow: hidden` 兜底。

> **极窄列表会隐藏时间**（`@container (max-width: 220px)`，对应列表宽约 236px 以下）：
> 标题行里「置顶图标 + 免打扰图标 + 时间」都是 `flex-shrink: 0`，合计约占 90px，
> 容器 182px 时留给会话名只剩 30 多px（两三个字）。时间在消息面板里还能看到，
> 会话名更该优先。不想要这条行为，删掉那个 `@container` 块即可。

### 内容顶破容器：这类 bug 的识别与自查

窄窗口下"子元素比父元素还宽"是这个项目反复出现的 bug 类型。已修的三处：

| 位置 | 症状 | 根因 |
| --- | --- | --- |
| `.conversation-list` / `.item` | 父 200px 时 `li` 量到 203.69px | grid 隐式 `auto` 轨道取 min-content；`el-badge` 的 `fit-content` |
| `FilePreview` 工具栏文件名 | 360px 手机上文件名顶破工具栏 | `max-width: 400px` 硬编码 + **缺 `white-space: nowrap`（省略号不生效）** |
| `ImageUploader` 预览图 / `FileMessage` 卡片 | 窄屏横向溢出 | `max-width: 320px` / `300px` 没有 `100%` 上限 |

**自查三条**（都写成了断言，见 `verify-device-layout.mjs` 第 13 组）：

1. **`text-overflow: ellipsis` 的同一规则块里必须有 `white-space: nowrap`**（或 line-clamp）——
   否则省略号完全不生效，文字会换行；而没有空格的长文件名（`IMG_20240101_123456.jpg`）
   连换行都救不了，`min-content` 就是整串，直接横向溢出。
2. **不要硬编码大 `max-width`**：组件里写 `max-width: 400px` 在窄屏会顶破容器，
   用 `max-width: min(400px, 45vw)` 或补 `width: 100%`。唯一例外是页面内容居中上限 `1200px`。
3. **grid/flex 容器要能收缩**：`grid-template-columns` 用 `minmax(0, 1fr)` 而不是裸 `1fr`
   （裸 `1fr` = `minmax(auto, 1fr)`，`auto` 下限取内容 min-content）；
   grid/flex 子项在需要压缩时加 `min-width: 0` 或 `overflow: hidden`。
   注意只给内层子项加不管用 —— **要加在真正溢出的那一层**。

### 全局小屏层

`html[data-short="true"]`（视口高 ≤ 560px）里已经统一处理：

- `--header-h`: 56px → **44px**（顶栏高度与各页面 `calc(... - var(--header-total-h))` 一起生效）
- `--el-drawer-padding-primary` / `--el-dialog-padding-primary`: → **12px**（抽屉/弹层内边距）
- 日历格高 `.el-calendar-day`: 46px → **34px**，图例字号 12px → 11px

组件自己的密度调整写 `@include rp.compact(...)` 或 `rp.short-viewport` 即可。

**结构切换**（桌面一套 / 手机一套）用全局工具类，由 `<html data-layout>` 驱动：

```html
<DesktopMainView class="desktop-only" />
<MobilePlanCards class="mobile-only" />
```

还有 `.portrait-only` / `.landscape-only` / `.touch-only` / `.mouse-only` / `.safe-top` /
`.safe-bottom` / `.safe-x`。

### JS 里读布局模式

```ts
import { useDeviceLayout } from "@/composables/use-device-layout";

const {
  tier,                                  // "phone" | "tablet" | "desktop"（三档）
  isPhoneTier, isTabletTier, isDesktopTier,
  isMobile, isPhoneLandscape, isShortViewport, isKeyboardOpen,
} = useDeviceLayout();
```

判定结果是**全局单例**，由 `installDeviceLayout()` 在 `app.mount()` 之前写入 `<html>`，
所以 JS 与 CSS 用的是同一份判定，不会出现「JS 认为手机、CSS 认为桌面」的半吊子状态。

### 字号规范

全局字号在 2026-10 做过一次**整体下调一档**（原来偏大）。当前档位：

| 档位 | 用途 | 出现量 |
| --- | --- | --- |
| 18px | 页面主标题 | 少 |
| 16px | 区块标题 | 少 |
| 15px | 小标题 / 强调 | 少 |
| **13px** | **主体文字（基准）** | 最多 |
| 12px | 密集区次要文字 | 多 |
| 11px | 次要说明（时间、预览） | 多 |
| 10px | 极小元信息（已读数、客户端状态）—— **下限，不要再小** | 少 |

- **基准 13px**：`body` 与 `.el-*` 组件的 `--el-font-size-base` 都对齐到 13px。
- **Element Plus 同步**：改字号时**必须**同时改 `styles/index.scss` 里的 6 个
  `--el-font-size-*`（写在 `html:root` 里，特异性高于 EP 自己的 `:root`），
  否则 EP 组件（按钮/输入框/日历/抽屉）会比自定义文字显大。
- **≥36px 的展示性大字不动**：gsap 动画、demo 头图、头像占位字母属于版式元素，不是界面文字。
- **不要再引入新档位**：现有 10 个档位已经偏多，`13px`/`15px` 这类介于整数档之间的值
  是历史遗留。新写样式请从上面的档位里挑。

> 想整体再调一次大小时：批量改各组件 `font-size` 的 px 值（保持落在既有档位上），
> 再同步那 6 个 `--el-font-size-*`。

### Element Plus 组件尺寸随窗口适配

分两级，覆盖「窄」和「矮」两种小窗口：

| 触发条件 | 机制 | 效果 |
| --- | --- | --- |
| 窗口宽度（连续） | `responsive.scss` 末尾的流体变量 | 组件高度 28→32px 随宽度平滑缩放，≥1000px 恢复 EP 默认 |
| 视口过矮（≤560px） | `App.vue` 的 `el-config-provider :size` | 整体降到 `small` 一档（横屏手机、分屏、被拉扁的窗口） |

**竖屏手机只走第一级**（宽度窄但高度充足）：EP 默认 32px 的输入框在触屏上已够点按，
降到 `small` 的 24px 反而难点中。这是刻意的，改之前先想清楚。

> **聊天页例外**：它按档位自己接管控件高度（大屏 32px、手机/平板 24px，
> 见「三档设备」一节）。同步的地方有 `.el-button`、`.el-button--small`、
> `.el-select__wrapper`、`.el-input__height` 与 composer 的 textarea 内边距。

> **为什么还要显式接管按钮高度**：EP 的按钮高度是**硬编码**的
> （`.el-button` 32px、`--small` 24px、`--large` 40px），根本不读 `--el-component-size`；
> 只有输入框等组件读。不接管就会出现「输入框缩了、按钮没缩」的错位。三条约束：
>
> 1. 用 `html` 前缀提高特异性，不依赖「我的样式排在 EP 之后」这个顺序假设；
> 2. 三个按钮档位必须按 **base → small → large** 顺序写
>    （小/大按钮同时带 `.el-button`，特异性相同时靠顺序决定胜负）；
> 3. 输入框用 `:not(.el-input--small):not(.el-input--large)` 守卫，
>    否则会把尺寸变体自己的 `--el-input-height` 压回默认值。
>
> 这三条都有断言守着（`verify-device-layout.mjs` 第 10 组），别绕过。

### CSS 变量

`use-device-layout` 会把这些写到 `<html>` 上（行内样式，优先级高于 `:root` 兜底值）：

| 变量 | 含义 |
| --- | --- |
| `--app-w` / `--app-h` | 真实视口宽高。`--app-h` 跟随地址栏与**软键盘**变化 |
| `--app-short-side` / `--app-long-side` / `--app-aspect` | 短边 / 长边 / 宽高比 |
| `--app-kb` | 软键盘占用高度，未弹起为 `0px` |
| `--safe-top` / `--safe-right` / `--safe-bottom` / `--safe-left` | 安全区（刘海/灵动岛/手势条） |
| `--header-total-h` | `--header-h + --safe-top`，所有「视口高度 − 顶栏」都该用它 |

> 全屏容器一律用 `height: var(--app-h)` 而不是 `100vh`（移动端 `100vh` 会把底部内容顶出屏幕）；
> 宽度用 `100%` 而不是 `100vw`（`100vw` 含滚动条宽度，会横向溢出）。
> 安全区依赖 `index.html` 里 viewport 的 `viewport-fit=cover`。

### 在真机上核对

打开 `/debug/telemetry`，埋点的 `device` 字段就记录了当时的判定结果
（`layout` / `orientation` / `isPhone` / `isPhoneLandscape` / `aspectRatio` / `shortSide` /
`longSide` / `keyboardOpen`），排查适配问题不用靠猜。
