/**
 * 将图片转换为WebP格式（仅H5环境支持，小程序端原样返回）
 * @param {string} filePath - 原始图片的路径（支持本地路径/网络URL）
 * @returns {Promise<string>} 转换后的WebP图片URL（H5）或原始路径（小程序）
 * 
 * 实现原理：
 * 1. H5环境：通过Canvas绘制图片并导出为WebP格式Blob
 * 2. 小程序环境：因API限制直接返回原路径（需服务端转换）
 */
export function compressImageToWebP(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // #ifdef H5
    const img = new Image();

    // 图片加载成功回调
    img.onload = () => {
      // 创建隐藏画布
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext('2d');

      // 绘制图片到画布
      if (ctx) {
        ctx.drawImage(img, 0, 0);

        // 导出为WebP格式（质量系数0.8）
        canvas.toBlob((blob) => {
          // 成功生成Blob则创建临时URL
          blob ? resolve(URL.createObjectURL(blob)) : resolve(filePath);
        }, 'image/webp', 1.0);
      } else {
        // 2D上下文获取失败时回退
        resolve(filePath);
      }
    };

    // 图片加载失败处理
    img.onerror = () => resolve(filePath);

    // 初始化图片源（触发加载）
    img.src = filePath;
    // #endif

    // #ifndef H5
    // 小程序端canvas API不支持导出webp格式
    // 实际业务中应由服务端进行格式转换
    resolve(filePath);
    // #endif
  });
}
