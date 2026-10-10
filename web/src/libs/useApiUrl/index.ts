interface image {
  RainbowID: string;
  imageName: string;
}
function PenaltySet() {
  let rootUrl =
    import.meta.env.VITE_WEB_BASE_API || "http://localhost:1314/MeowMemoirs/"; //'http://172.16.1.236:999/'
  const getStaticFileUrl = (name: string) => {
    return `${rootUrl}File/DownloadFile?path=StaticFile/${name}`;
  };
  //恋爱日记
  function getLoveImgUrl(name: string) {
    return `${rootUrl}File/MediaFile/LoveCalendar/MapStorage?path=${name}`;
  }
  //系统照片
  function getLocalImgUrl(name: string) {
    return `${rootUrl}File/MediaFile/indigenous/MapStorage?path=${name}`;
  }
  //用户头像
  function DownloadUserImgUrl(data: image) {
    return `${rootUrl}File/MediaFile/${data.RainbowID}/MapStorage?path=${
      data.imageName.split(".")[0]
    }&d=save`;
  }
  //用户头像
  function getUserImgUrl(data: image) {
    return `${rootUrl}File/MediaFile/${data.RainbowID}/MapStorage?path=${
      data.imageName.split(".")[0]
    }.webp`;
  }
  function getHouseUserImgUrl(data: image) {
    return `${rootUrl}File/MediaFile/indigenous/MapStorage?path=${
      data.imageName.split(".")[0]
    }.webp`;
  }
  //留言板
  function getMessageImgUrl(data: image) {
    return `${rootUrl}File/MediaFile/${
      data.RainbowID
    }/MapStorage?path=messageImage/${data.imageName.split(".")[0]}.webp`;
  }
  //匿名留言
  function getHouseImgUrl(data: image) {
    return `${rootUrl}File/MediaFile/${
      data.RainbowID
    }/MapStorage?path=messageImage/${
      data.imageName.split(".")[0]
    }.webp&d=house`;
  }
  //图片集
  function getImgUrl(data: image) {
    return `${rootUrl}File/MediaFile/indigenous/MapStorage?path=image/2- (${data}).jpg`;
  }
  //Gallery
  function getGalleryImgUrl(filename: string) {
    return `${rootUrl}File/Gallerys/Images?filename=${filename}`;
  }
  return {
    getStaticFileUrl,
    getLoveImgUrl,
    getLocalImgUrl,
    getUserImgUrl,
    getHouseUserImgUrl,
    DownloadUserImgUrl,
    getMessageImgUrl,
    getHouseImgUrl,
    getImgUrl,
    getGalleryImgUrl,
  };
}
export default PenaltySet; // 导出
