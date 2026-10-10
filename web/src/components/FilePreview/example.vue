<template>
  <div class="file-preview-demo">
    <h2>文件预览组件示例</h2>

    <!-- 触发按钮 -->
    <div class="demo-buttons">
      <el-button type="primary" @click="openSinglePreview">
        单文件预览
      </el-button>
      <el-button type="success" @click="openMultiplePreview">
        多文件预览(画廊模式)
      </el-button>
    </div>

    <!-- 文件列表展示 -->
    <div class="file-list">
      <h3>可预览的文件:</h3>
      <el-table :data="sampleFiles" style="width: 100%">
        <el-table-column prop="name" label="文件名" width="300" />
        <el-table-column prop="type" label="类型" width="120" />
        <el-table-column label="操作">
          <template #default="{ row }">
            <el-button size="small" @click="previewSingle(row)">
              预览
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 文件预览组件 -->
    <FilePreview v-model="previewVisible" v-model:current-index="currentFileIndex" :file-list="previewFiles"
      :cover-url="coverUrl" @close="handleClose" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import FilePreview from './index.vue'


const coverUrl = ref('https://check.meowmemoirs.cn/mm/Files/users/8/b15460ef710a3ecdaa6715f85fdc3f180cb0f929b0717017960b90b730f47da3')// 预览状态
const previewVisible = ref(false)
const currentFileIndex = ref(0)
const previewFiles = ref<any[]>([])

// 示例文件列表
const sampleFiles = [
  {
    name: '示例图片.jpg',
    url: 'https://picsum.photos/1920/1080',
    type: 'image'
  },
  {
    name: '示例图片2.png',
    url: 'https://picsum.photos/1920/1080?random=2',
    type: 'image'
  },
  {
    name: '示例视频.mp4',
    url: 'https://www.w3schools.com/html/mov_bbb.mp4',
    type: 'video'
  },
  {
    name: '示例音频.mp3',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    type: 'audio'
  },
  {
    name: '示例文档.pdf',
    url: 'https://example.com/sample.pdf',
    type: 'pdf'
  }
]

// 打开单文件预览
const openSinglePreview = () => {
  previewFiles.value = [sampleFiles[0]]
  currentFileIndex.value = 0
  previewVisible.value = true
}

// 打开多文件预览
const openMultiplePreview = () => {
  previewFiles.value = sampleFiles
  currentFileIndex.value = 0
  previewVisible.value = true
}

// 预览单个文件
const previewSingle = (file: any) => {
  previewFiles.value = [file]
  currentFileIndex.value = 0
  previewVisible.value = true
}

// 关闭回调
const handleClose = () => {
  console.log('预览已关闭')
}
</script>

<style scoped lang="scss">
.file-preview-demo {
  padding: 20px;

  h2 {
    margin-bottom: 20px;
  }

  .demo-buttons {
    display: flex;
    gap: 12px;
    margin-bottom: 30px;
  }

  .file-list {
    h3 {
      margin-bottom: 16px;
    }
  }
}
</style>
