<script setup lang="ts">
/**
 * 文件消息详情面板（外壳）。
 *
 * 承载「文件消息（音频 / 文档 / 压缩包…）点开之后」的全部操作：
 * 下载按钮从消息卡片里撤掉、收进这里，预览也从这里发起。
 * 内容由 FileMessageDetailBody.vue 提供，本文件只管「套哪种外壳」。
 *
 * ## 形态
 *
 *   手机（含横屏手机）  →  `el-drawer direction="btt"`，从底部弹出
 *   平板 / 电脑         →  `el-dialog`，居中对话框
 *
 * 判定用 `isPhoneTier || isPhone`，而不是 `isMobile`：
 * `isPhone` 是**几何上**是不是手机（含横屏 852x393），而竖屏平板 820x1180
 * 的短边是 820 > 480，不会被误判成手机 —— 平板仍然是对话框，只有真手机才用抽屉。
 *
 * ⚠️ 这里必须写 `<el-drawer>` / `<el-dialog>` 标签，不能用 `<component :is>`：
 * 本项目 Element Plus 是按需引入（unplugin-vue-components + ElementPlusResolver），
 * 组件样式跟着模板里的标签走。换成动态组件就得从 'element-plus' 显式 import 组件，
 * 静态分析看不到标签 → **抽屉的 CSS 不会被引入** → 弹层 position 退回 static，
 * 表现是「从顶部冒出来、不贴底」。
 */
import { computed } from 'vue';
import { useDeviceLayout } from '@/composables/use-device-layout';
import FileMessageDetailBody from './FileMessageDetailBody.vue';

const props = withDefaults(
  defineProps<{
    /** 文件名，同时作为标题栏文本（过宽省略）。 */
    fileName: string;
    /** 字节数。 */
    fileSize: number;
    /** 中文类型文案，例如「PDF」「音频」。 */
    typeLabel: string;
    /** 缩略图图标（SvgIcon 的 iconClass）。 */
    iconClass: string;
    /** 发送时间（ISO 字符串）。 */
    sentAt?: string | null;
    /** 预览不可用（该类型不支持 / 文件过大）。 */
    previewDisabled?: boolean;
    /** 预览不可用的原因。 */
    previewHint?: string;
    /** 下载不可用（拿不到 fileKey 等异常情况）。 */
    downloadDisabled?: boolean;
  }>(),
  {
    sentAt: '',
    previewDisabled: false,
    previewHint: '',
    downloadDisabled: false,
  },
);

const visible = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  download: [];
  preview: [];
}>();

const { isPhoneTier, isPhone } = useDeviceLayout();

/** 手机（含横屏手机）走底部抽屉，平板/电脑走对话框。 */
const isBottomSheet = computed(() => isPhoneTier.value || isPhone.value);
</script>

<template>
  <!-- 手机：底部抽屉。size="auto" 让高度贴合内容，不铺满整屏 -->
  <el-drawer v-if="isBottomSheet" v-model="visible" direction="btt" size="auto" append-to-body
    class="file-detail-panel is-sheet">
    <template #header="{ titleId }">
      <div class="file-detail-header">
        <!-- 标题栏只放文件名：过宽省略，完整名字留在 title 属性里 -->
        <h3 :id="titleId" class="file-detail-title" :title="fileName">{{ fileName }}</h3>
      </div>
    </template>

    <FileMessageDetailBody :file-size="fileSize" :type-label="typeLabel" :icon-class="iconClass" :sent-at="sentAt"
      :preview-disabled="previewDisabled" :preview-hint="previewHint" :download-disabled="downloadDisabled"
      @download="emit('download')" @preview="emit('preview')" />
  </el-drawer>

  <!-- 平板 / 电脑：居中对话框 -->
  <el-dialog v-else v-model="visible" width="min(92vw, 420px)" align-center append-to-body
    class="file-detail-panel is-dialog">
    <template #header="{ titleId }">
      <div class="file-detail-header">
        <h3 :id="titleId" class="file-detail-title" :title="fileName">{{ fileName }}</h3>
      </div>
    </template>

    <FileMessageDetailBody :file-size="fileSize" :type-label="typeLabel" :icon-class="iconClass" :sent-at="sentAt"
      :preview-disabled="previewDisabled" :preview-hint="previewHint" :download-disabled="downloadDisabled"
      @download="emit('download')" @preview="emit('preview')" />
  </el-dialog>
</template>

<style scoped lang="scss">
.file-detail-header {
  display: flex;
  align-items: center;
  // 关闭按钮（对话框是绝对定位在右上角，抽屉是 header 的 flex 兄弟节点）
  // 都要让开，否则长标题会钻到叉号下面。
  min-width: 0;
  padding-right: 24px;
}

.file-detail-title {
  // 省略号三件套：宽度由外壳决定，这里只负责「过宽省略多余部分」
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

<style lang="scss">
////
/// Element Plus 内部结构的覆盖（**不 scoped**）。
///
/// 抽屉/对话框都设了 append-to-body，DOM 被搬到 <body> 下，
/// 它们自身的 .el-overlay / .el-drawer / .el-dialog 拿不到本组件的
/// data-v 属性，scoped 选择器命中不了 —— 所以这一小块单独放开。
/// 选择器统一用 .file-detail-panel 打头，不会外溢到别处的弹窗。
////
.file-detail-panel {
  // 手机抽屉：贴底 + 圆角 + 让开手势条
  &.is-sheet {
    .el-drawer {
      border-radius: 14px 14px 0 0;
      overflow: hidden;
    }

    .el-drawer__header {
      margin-bottom: 0;
      padding: 14px 16px 4px;
    }

    .el-drawer__body {
      padding: 12px 16px calc(16px + var(--safe-bottom, 0px));
    }

    // 抽屉底部是单手区：两个按钮铺满两侧，而不是缩在中间
    .file-detail-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
    }
  }

  // 桌面对话框：标题与正文的留白按 EP 的 token 走，只补标题横向空间
  &.is-dialog {
    .el-dialog__header {
      padding-bottom: 8px;
    }

    .el-dialog__body {
      padding-top: 0;
    }
  }
}
</style>
