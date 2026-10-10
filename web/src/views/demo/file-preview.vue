<template>
  <div class="file-preview-demo-page">
    <div class="demo-header">
      <h1>文件预览组件演示</h1>
      <p class="subtitle">支持图片、视频、音频、PDF、Markdown和Office文档的全屏预览</p>
    </div>

    <!-- 功能卡片 -->
    <div class="feature-cards">
      <div class="feature-card" @click="openImagePreview">
        <div class="card-icon image">
          <svg viewBox="0 0 24 24" width="48" height="48">
            <path fill="currentColor"
              d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
          </svg>
        </div>
        <h3>图片预览</h3>
        <p>JPG, PNG, GIF, WebP, SVG等</p>
      </div>

      <div class="feature-card" @click="openVideoPreview">
        <div class="card-icon video">
          <svg viewBox="0 0 24 24" width="48" height="48">
            <path fill="currentColor"
              d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
          </svg>
        </div>
        <h3>视频预览</h3>
        <p>MP4, WebM, OGG等格式</p>
      </div>

      <div class="feature-card" @click="openAudioPreview">
        <div class="card-icon audio">
          <svg viewBox="0 0 24 24" width="48" height="48">
            <path fill="currentColor" d="M12 3v9.28a4.39 4.39 0 0 0-1.5-.28 4.5 4.5 0 1 0 4.5 4.5V6h4V3h-7z" />
          </svg>
        </div>
        <h3>音频预览</h3>
        <p>MP3, WAV, AAC等格式</p>
      </div>

      <div class="feature-card" @click="openDocumentPreview">
        <div class="card-icon document">
          <svg viewBox="0 0 24 24" width="48" height="48">
            <path fill="currentColor"
              d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11z" />
          </svg>
        </div>
        <h3>文档预览</h3>
        <p>PDF, Word, Excel, PPT</p>
      </div>
    </div>

    <!-- 示例区域 -->
    <div class="demo-sections">
      <div class="demo-section">
        <h2>单文件预览</h2>
        <div class="file-grid">
          <div v-for="(file, index) in sampleFiles" :key="index" class="file-item" @click="previewSingle(file)">
            <div class="file-preview-thumb">
              <img v-if="file.type === 'image'" :src="file.url" :alt="file.name" />
              <div v-else class="file-type-badge" :class="file.type">
                {{ file.type.toUpperCase() }}
              </div>
            </div>
            <div class="file-info">
              <span class="file-name">{{ file.name }}</span>
              <span class="file-action">点击预览</span>
            </div>
          </div>
        </div>
      </div>

      <div class="demo-section">
        <h2>画廊模式 - 多文件浏览</h2>
        <el-button type="primary" size="large" @click="openGallery">
          打开画廊模式
        </el-button>
        <p class="hint">包含所有类型的文件,可以使用左右箭头或键盘导航切换</p>
      </div>
    </div>

    <!-- 文件预览组件 -->
    <FilePreview v-model="previewVisible" v-model:current-index="currentFileIndex" :file-list="previewFiles"
      @close="handleClose" :cover-url="coverUrl" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import FilePreview from '@/components/FilePreview/index.vue'

// 预览状态
const previewVisible = ref(false)
const currentFileIndex = ref(0)
const previewFiles = ref<any[]>([])

const coverUrl = ref('https://check.meowmemoirs.cn/mm/Files/users/8/b15460ef710a3ecdaa6715f85fdc3f180cb0f929b0717017960b90b730f47da3')

// 示例文件列表
const sampleFiles = [
  {
    name: '1.jpg',
    url: '/data/1.jpg',
    type: 'image'
  },
  {
    name: '2.jpg',
    url: '/data/2.jpg',
    type: 'image'
  },
  {
    name: '3.jpg',
    url: '/data/3.jpg',
    type: 'image'
  },
  {
    name: '4.jpg',
    url: '/data/4.jpg',
    type: 'image'
  },
  {
    name: '5.jpg',
    url: '/data/5.jpg',
    type: 'image'
  },
  {
    name: '6.jpg',
    url: '/data/6.jpg',
    type: 'image'
  },
  {
    name: '7.jpg',
    url: '/data/7.jpg',
    type: 'image'
  },
  {
    name: '8.jpg',
    url: '/data/8.jpg',
    type: 'image'
  },
  {
    name: '98.jpg',
    url: '/data/9.jpg',
    type: 'image'
  },
  {
    name: '10.jpg',
    url: '/data/10.jpg',
    type: 'image'
  },
  {
    name: '11.jpg',
    url: '/data/11.jpg',
    type: 'image'
  },
  {
    name: '12.jpg',
    url: '/data/12.jpg',
    type: 'image'
  },
  {
    name: '13.jpg',
    url: '/data/13.jpg',
    type: 'image'
  },
  {
    name: '14.jpg',
    url: '/data/14.jpg',
    type: 'image'
  },
  {
    name: '1.mp4',
    url: '/data/1.mp4',
    type: 'video'
  },
  {
    name: '2.mp4',
    url: '/data/2.mp4',
    type: 'video'
  },
  {
    name: '张韶涵,HOYO-MiX - 昔涟.mp3',
    url: '/data/张韶涵,HOYO-MiX - 昔涟.mp3',
    type: 'audio'
  },
  {
    name: '社死小铃声.mp3',
    url: '/data/社死小铃声.mp3',
    type: 'audio'
  },
  {
    name: '来电.wav',
    url: '/data/来电.wav',
    type: 'audio'
  },
  {
    name: '来电.flac',
    url: '/data/来电.flac',
    type: 'audio'
  },
  {
    name: '背景音乐.mp3',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    type: 'audio'
  },
  {
    name: '打卡功能网站开发文档_202601121315_58609.doc',
    url: '/data/打卡功能网站开发文档_202601121315_58609.doc',
    type: 'pdf'
  },
  {
    name: '打卡功能网站开发文档_202601121315_58609.txt',
    url: '/data/打卡功能网站开发文档_202601121315_58609.txt',
    type: 'pdf'
  },
  {
    name: 'API接口文档.md',
    url: '/data/API接口文档.md',
    type: 'markdown'
  },
  {
    name: '示例文档.pdf',
    url: 'https://pdfobject.com/pdf/sample.pdf',
    type: 'pdf'
  }
]

// 打开图片预览
const openImagePreview = () => {
  const images = sampleFiles.filter(f => f.type === 'image')
  previewFiles.value = images
  currentFileIndex.value = 0
  previewVisible.value = true
}

// 打开视频预览
const openVideoPreview = () => {
  const videos = sampleFiles.filter(f => f.type === 'video')
  previewFiles.value = videos
  currentFileIndex.value = 0
  previewVisible.value = true
}

// 打开音频预览
const openAudioPreview = () => {
  const audios = sampleFiles.filter(f => f.type === 'audio')
  previewFiles.value = audios
  currentFileIndex.value = 0
  previewVisible.value = true
}

// 打开文档预览
const openDocumentPreview = () => {
  const docs = sampleFiles.filter(f => f.type === 'pdf')
  previewFiles.value = docs
  currentFileIndex.value = 0
  previewVisible.value = true
}

// 预览单个文件
const previewSingle = (file: any) => {
  previewFiles.value = [file]
  currentFileIndex.value = 0
  previewVisible.value = true
}

// 打开画廊模式
const openGallery = () => {
  previewFiles.value = sampleFiles
  currentFileIndex.value = 0
  previewVisible.value = true
}

// 关闭回调
const handleClose = () => {
  console.log('预览已关闭')
}
</script>

<style scoped lang="scss">
.file-preview-demo-page {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 40px 20px;
  // 滚动条纵向
  overflow-x: auto;

  .demo-header {
    text-align: center;
    color: #fff;
    margin-bottom: 40px;

    h1 {
      font-size: 36px;
      margin: 0 0 10px 0;
      font-weight: 600;
    }

    .subtitle {
      font-size: 16px;
      opacity: 0.9;
      margin: 0;
    }
  }

  .feature-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 20px;
    max-width: 1200px;
    margin: 0 auto 40px;

    .feature-card {
      background: rgba(255, 255, 255, 0.95);
      border-radius: 12px;
      padding: 30px;
      text-align: center;
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);

      &:hover {
        transform: translateY(-5px);
        box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
      }

      .card-icon {
        width: 80px;
        height: 80px;
        margin: 0 auto 16px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;

        &.image {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: #fff;
        }

        &.video {
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          color: #fff;
        }

        &.audio {
          background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
          color: #fff;
        }

        &.document {
          background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
          color: #fff;
        }
      }

      h3 {
        font-size: 20px;
        margin: 0 0 8px 0;
        color: #333;
      }

      p {
        font-size: 14px;
        color: #666;
        margin: 0;
      }
    }
  }

  .demo-sections {
    max-width: 1200px;
    margin: 0 auto;

    .demo-section {
      background: rgba(255, 255, 255, 0.95);
      border-radius: 12px;
      padding: 30px;
      margin-bottom: 30px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);

      h2 {
        font-size: 24px;
        margin: 0 0 20px 0;
        color: #333;
      }

      .hint {
        margin-top: 12px;
        color: #666;
        font-size: 14px;
      }

      .file-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 16px;

        .file-item {
          border: 2px solid #e0e0e0;
          border-radius: 8px;
          overflow: hidden;
          cursor: pointer;
          transition: all 0.2s ease;

          &:hover {
            border-color: #667eea;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
          }

          .file-preview-thumb {
            height: 150px;
            background: #f5f5f5;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;

            img {
              width: 100%;
              height: 100%;
              object-fit: cover;
            }

            .file-type-badge {
              padding: 8px 16px;
              border-radius: 4px;
              font-weight: bold;
              color: #fff;
              font-size: 14px;

              &.video {
                background: #f5576c;
              }

              &.audio {
                background: #4facfe;
              }

              &.pdf {
                background: #ff6b6b;
              }
            }
          }

          .file-info {
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 4px;

            .file-name {
              font-size: 14px;
              color: #333;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }

            .file-action {
              font-size: 12px;
              color: #667eea;
            }
          }
        }
      }
    }
  }
}
</style>
