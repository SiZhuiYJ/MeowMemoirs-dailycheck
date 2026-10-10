// <script setup lang="ts">
// import { ref, watch } from 'vue';
// import { useDebounceFn } from './composables/useDebounceFn';

// const keyword = ref('');
// const loading = ref(false);

// // 模拟搜索接口
// async function searchApi(value: string) {
//   console.log('发起搜索:', value);
//     // 实际请求...
//       loading.value = false;
//       }

//       // 创建防抖函数
//       const { debounced: debouncedSearch, cancel } = useDebounceFn(
//         async (value: string) => {
//             loading.value = true;
//                 await searchApi(value);
//                   },
//                     500
//                     );

//                     // 监听 keyword 变化，触发防抖搜索
//                     watch(keyword, (newVal) => {
//                       debouncedSearch(newVal);
//                       });
//                       </script>

//                       <template>
//                         <div>
//                             <input v-model="keyword" placeholder="输入搜索内容..." />
//                                 <span v-if="loading">搜索中...</span>
//                                     <button @click="cancel">取消待执行搜索</button>
//                                       </div>
//                                       </template>
// composables/useDebounceFn.ts
import { onUnmounted } from "vue";

export function useDebounceFn<T extends (...args: any[]) => any>(
  fn: T,
  delay: number = 300,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const debounced = function (this: any, ...args: Parameters<T>) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
      timer = null;
    }, delay);
  };

  // 取消尚未执行的防抖
  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  // 组件卸载时自动清理
  onUnmounted(cancel);

  return {
    debounced,
    cancel,
  };
}
