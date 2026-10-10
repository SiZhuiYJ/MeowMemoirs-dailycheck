import type { Ref } from "vue";
import { SettingApi } from "@/features/setting/api";
import { useAuthStore } from "@/stores";
import { createAvatarUploadFormData } from "@/utils/avatar";
import { notifyError, notifySuccess } from "@/utils/notification";

export async function uploadFile(file: File, loading: Ref<boolean>) {
  loading.value = true;
  const authStore = useAuthStore();

  try {
    const formData = await createAvatarUploadFormData(file);
    const response = await SettingApi.UploadImage(formData);

    if (response.status !== 200) {
      notifyError("头像上传失败");
      return;
    }

    const key = response.data.key;
    if (key && authStore.user?.userId) {
      authStore.updateUser({ avatarKey: key });
      notifySuccess("头像上传成功");
      return;
    }

    notifyError("头像上传失败: 返回数据无效");
  } catch (error) {
    console.error("Upload error:", error);
    notifyError("头像上传失败: 网络错误");
  } finally {
    loading.value = false;
  }
}

export function base64ToFile(
  base64: string,
  mimeType: string,
  fileName: string = "file",
): File {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new File([bytes], fileName, { type: mimeType });
}

export function dataURLToFile(
  dataUrl: string,
  fileName: string = "image.png",
): File | null {
  const arr = dataUrl.split(",");
  if (!arr[0]) return null;

  const mime = arr[0].match(/:(.*?);/)?.[1] || "image/png";
  if (!arr[1]) return null;

  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], fileName, { type: mime });
}
