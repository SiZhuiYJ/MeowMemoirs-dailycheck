/**
 * 图片复制到剪贴板。
 *
 * 浏览器对「写入图片」的支持差异很大：
 *   · Chromium / Edge：支持 ClipboardItem + image/png；
 *   · Firefox：多数版本只支持文本；
 *   · 非安全上下文（http、老 WebView）：navigator.clipboard 可能整个不存在。
 *
 * 因此这里按「图片 → 图片链接 → 老式 execCommand」逐级降级，
 * 调用方只需要根据返回值提示用户实际复制到的是什么。
 */
export type CopyImageResult = "image" | "link";

async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!blob) throw new Error("图片转 PNG 失败");
  return blob;
}

/** 把任意浏览器能解码的图片（含 webp）转成剪贴板普遍支持的 png。 */
async function convertImageBlobToPng(blob: Blob): Promise<Blob> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法创建画布");
      context.drawImage(bitmap, 0, 0);
      return await canvasToPngBlob(canvas);
    } finally {
      bitmap.close?.();
    }
  }

  // 兜底：没有 createImageBitmap 的浏览器走 <img> + canvas
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("图片解码失败"));
      element.src = objectUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建画布");
    context.drawImage(image, 0, 0);
    return await canvasToPngBlob(canvas);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function writeTextWithLegacyApi(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

/** 复制纯文本：优先 Clipboard API，失败时退回老式 execCommand。 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (!text) throw new Error("没有可复制的内容");

  if (typeof navigator.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 继续走 execCommand
    }
  }

  if (!writeTextWithLegacyApi(text)) {
    throw new Error("当前浏览器不支持复制");
  }
}

/**
 * 复制图片。参数通常传文件缓存里的 blob: URL（已带鉴权、无需再请求服务器）。
 *
 * 返回 "image" 表示图片已进剪贴板；"link" 表示浏览器不支持图片写入，
 * 已退化为复制图片地址。
 */
export async function copyImageFromUrl(url: string): Promise<CopyImageResult> {
  if (!url) throw new Error("图片地址为空");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`图片加载失败（${response.status}）`);
  const sourceBlob = await response.blob();

  const canWriteImage =
    typeof ClipboardItem !== "undefined" &&
    typeof navigator.clipboard?.write === "function";

  if (canWriteImage) {
    try {
      const pngBlob =
        sourceBlob.type === "image/png" ? sourceBlob : await convertImageBlobToPng(sourceBlob);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
      return "image";
    } catch (error) {
      // 权限被拒、图片过大、浏览器实现不完整……都继续走文本兜底
      console.warn("[chat] 复制图片到剪贴板失败，尝试复制图片链接", error);
    }
  }

  // 退化：至少把图片地址复制出去
  await copyTextToClipboard(url);
  return "link";
}
