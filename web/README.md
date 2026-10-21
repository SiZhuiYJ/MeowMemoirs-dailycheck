# 喵咪记事簿 · Web 前端

`Vue 3` + `TypeScript` + `Vite` + `Element Plus` + `Pinia`。

```bash
npm install
npm run dev      # 开发服务器，默认 http://localhost:5173
npm run build    # vue-tsc -b 类型检查 + vite build
```

接口地址由 `.env.development` 的 `VITE_API_BASE_URL` 决定。

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

横屏手机是 `layout: desktop` + `isPhone: true`；700×1200 的窄窗口是
`layout: mobile` + `isPhone: false`。**`isPhone` 不参与布局切换。**

### 规则实现在哪

| 文件 | 用途 |
| --- | --- |
| `src/utils/device-layout.ts` | JS 判定（`classifyViewport()` 是纯函数） |
| `src/styles/responsive-mixins.scss` | CSS 判定（`$bp-*` 常量 + mixin） |

两边**必须同步修改**。`tools/dev-verify/verify-device-layout.mjs` 会校验一致性
（断点常量漂移、全矩阵判定、`@mixin desktop` 是否为 `@mixin phone` 的严格取反、
`@mixin phone` 有没有带 `orientation: portrait`）；`verify-device-layout-dom.mjs`
再校验「判定结果 → `<html>` 属性 / CSS 变量」这段契约（CSS 正是靠它切换结构的）。
两个都不需要后端，改完响应式相关代码跑一下：

```bash
node tools/dev-verify/verify-device-layout.mjs
node tools/dev-verify/verify-device-layout-dom.mjs
```

### 写响应式样式

**优先用 `responsive-mixins.scss` 的 mixin，不要写裸 `@media (max-width: 768px)`**，
否则横屏手机（宽 852）会漏掉。

**两条轴要分清** —— 这是最容易混的地方：

| 轴 | 管什么 | 用什么 |
| --- | --- | --- |
| **布局结构** | 桌面双栏 / 手机单栏 | `rp.phone` / `rp.desktop`、`.desktop-only` / `.mobile-only` |
| **紧凑密度** | 间距、字号、内外边距 | `rp.compact($max)` / `rp.short-viewport` |

横屏手机（852×393）是「**桌面结构 + 小屏密度**」：结构上走桌面双栏，
但只有 393px 高，间距字号必须按小屏收，否则 300px 列表加大间距会把内容挤没。

```scss
<style scoped lang="scss">
@use "@/styles/responsive-mixins" as rp;

.panel {
  padding: 16px;

  // 布局结构：手机布局 = 竖屏 且 宽 <= 768（横屏一律不命中）
  @include rp.phone {
    grid-template-columns: 1fr;
  }

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

> 聊天页的紧凑密度用的就是这个阈值。以前用手机断点 768px，
> 结果 900×700 这类窗口「桌面布局 + 桌面间距」，会话列表列只有约 263px 却吃 12px 间距。

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

const { isMobile, isPhoneLandscape, isShortViewport, isKeyboardOpen } = useDeviceLayout();
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
