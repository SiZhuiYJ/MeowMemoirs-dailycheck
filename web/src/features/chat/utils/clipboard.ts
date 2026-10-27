/**
 * 图片复制到剪贴板。
 *
 * 浏览器对「写入图片」的支持差异很大：
 *   · Chromium / Edge：安全上下文（HTTPS / localhost）下支持 ClipboardItem + image/png；
 *   · WebKit：只有在用户手势内同步发起 write 才会被放行；
 *   · HTTP 局域网（如 http://192.168.x.x:5173）：navigator.clipboard 整个不存在，
 *     但 document.execCommand("copy") 仍可用，只是剪贴板里是「带图片的 HTML」。
 *
 * 因此这里按「PNG 图片 → 图文 HTML → 图片地址」逐级降级：
 *   1. 支持 Async Clipboard 时同步调用 write，把等待解码的 Promise 交给
 *      ClipboardItem，避免 WebKit 在 await 之后丢失用户手势；
 *   2. HTTP 下用隐藏的 contenteditable + 选中 <img> 走 execCommand，
 *      粘贴到聊天软件 / 富文本编辑器时仍是一张图；
 *   3. 只有真实 http(s) 地址才退化为复制链接，blob: 链接复制出去没有意义，
 *      此时直接报错让用户改用 HTTPS 或下载。
 */
export type CopyImageResult = "image" | "rich-image" | "link";

/** 当前环境是否能通过 Async Clipboard API 真正写入 image/png（需要安全上下文）。 */
function canCopyImageToClipboard(): boolean {
  return (
    typeof ClipboardItem !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  );
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  return blob.then((value) => {
    if (!value) throw new Error("图片转 PNG 失败");
    return value;
  });
}

/** 把任意浏览器能解码的图片（含 webp / gif）转成剪贴板普遍支持的 png。 */
async function convertImageBlobToPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;

  if (typeof createImageBitmap === "function") {
    try {
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
    } catch (error) {
      // 某些格式（如 SVG）在部分浏览器里 createImageBitmap 会失败，继续走 <img> 解码。
      console.warn("[chat] createImageBitmap 解码失败，改用 <img> 解码", error);
    }
  }

  // 兜底：没有 createImageBitmap 或它解码失败时走 <img> + canvas
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("图片解码失败"));
      element.src = objectUrl;
    });

    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) throw new Error("图片尺寸无效");

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("图片转 data URL 失败"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

/**
 * HTTP 局域网下的兼容方案：把图片放进隐藏的 contenteditable 并选中，
 * 再执行 execCommand("copy")。剪贴板里是 text/html，粘贴到聊天输入框、
 * 邮件或富文本编辑器里仍会显示为一张图。
 */
async function copyImageWithLegacySelection(blob: Blob): Promise<boolean> {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;

  const dataUrl = await blobToDataUrl(blob);
  const host = document.createElement("div");
  host.contentEditable = "true";
  host.setAttribute("aria-hidden", "true");
  // 聚焦隐藏的 contenteditable 时不要弹出手机软键盘。
  host.setAttribute("inputmode", "none");
  Object.assign(host.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    opacity: "0",
    pointerEvents: "none",
  });

  const image = document.createElement("img");
  image.src = dataUrl;
  image.alt = "";
  host.appendChild(image);

  const selection = document.getSelection();
  const savedRanges: Range[] = [];
  if (selection) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      savedRanges.push(selection.getRangeAt(index).cloneRange());
    }
  }

  document.body.appendChild(host);
  try {
    if (!image.complete) {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("图片解码失败"));
      });
    }
    await image.decode?.().catch(() => {
      // decode() 只是提前预热，失败时 copy 仍可能成功。
    });
    if (!image.naturalWidth) throw new Error("图片解码失败");

    host.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNode(image);
    selection?.removeAllRanges();
    selection?.addRange(range);

    return document.execCommand("copy");
  } finally {
    selection?.removeAllRanges();
    // 只恢复仍挂在文档里的选区，避免把已卸载节点重新塞回 Selection。
    for (const range of savedRanges) {
      if (document.contains(range.startContainer) && document.contains(range.endContainer)) {
        selection?.addRange(range);
      }
    }
    host.remove();
  }
}

async function fetchImageBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`图片加载失败（${response.status}）`);
  return response.blob();
}

/**
 * 复制图片。参数通常传文件缓存里的 blob: URL（已带鉴权、无需再请求服务器）。
 *
 * 返回 "image" 表示真正的 PNG 已进剪贴板；"rich-image" 表示 HTTP 兼容模式下
 * 写入的是图文 HTML；"link" 表示只复制到了图片地址。
 */
export async function copyImageFromUrl(url: string): Promise<CopyImageResult> {
  if (!url) throw new Error("图片地址为空");

  // 先开始取图，但不要 await：Async Clipboard 的 write 必须在用户手势里
  // 同步发起（WebKit 尤其严格），把等待交给 ClipboardItem 里的 Promise。
  const sourcePromise = fetchImageBlob(url);
  // 失败由下面 await 的地方处理，这里先挂一个空 catch，避免 write 提前失败时
  // sourcePromise / pngPromise 变成未处理的 rejection。
  sourcePromise.catch(() => {});

  let pngPromise: Promise<Blob> | null = null;
  if (canCopyImageToClipboard()) {
    pngPromise = sourcePromise.then(convertImageBlobToPng);
    pngPromise.catch(() => {});
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": pngPromise }),
      ]);
      return "image";
    } catch (error) {
      // 权限被拒、WebKit 手势失效、图片过大、浏览器实现不完整……继续走兼容模式。
      console.warn("[chat] 图片写入剪贴板失败，尝试图文兼容模式", error);
    }
  }

  let sourceBlob: Blob;
  try {
    if (pngPromise) {
      try {
        sourceBlob = await pngPromise;
      } catch {
        // PNG 转换失败（例如 SVG）时仍可用原图走图文兼容模式。
        sourceBlob = await sourcePromise;
      }
    } else {
      sourceBlob = await sourcePromise;
    }
  } catch (error) {
    // 取图都失败时，只有真实 http(s) 地址才值得退化为复制链接。
    if (/^https?:\/\//i.test(url)) {
      await copyTextToClipboard(url);
      return "link";
    }
    throw error;
  }

  // 兼容模式也统一转成 PNG：聊天图片多是 webp，部分 Windows 聊天工具
  // 和富文本编辑器不认 data:image/webp，PNG 的接受面更广。
  let richBlob = sourceBlob;
  if (richBlob.type !== "image/png") {
    try {
      richBlob = await convertImageBlobToPng(richBlob);
    } catch (error) {
      console.warn("[chat] 兼容模式转 PNG 失败，继续使用原图", error);
    }
  }

  try {
    if (await copyImageWithLegacySelection(richBlob)) return "rich-image";
  } catch (error) {
    console.warn("[chat] 图文兼容复制失败", error);
  }

  // blob: / data: 地址复制到别处没有意义，宁可直接报错让用户下载或改用 HTTPS。
  if (/^https?:\/\//i.test(url)) {
    await copyTextToClipboard(url);
    return "link";
  }
  throw new Error("当前浏览器不支持复制图片，请下载图片或改用 HTTPS 打开");
}
