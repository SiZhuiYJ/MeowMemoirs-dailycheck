import http from "@/libs/http";

export const FileApi = {
  UploadImage(formData: FormData) {
    return http.upload<{ url: string }>('/mm/Files/images', formData);
  },
  GetImage(url: string) {
    return http.getImage<Blob>(url);
  },
};
