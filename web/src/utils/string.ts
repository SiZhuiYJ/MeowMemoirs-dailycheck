/**
 * 生成随机字符串 字符串仅包含数字字母
 * @param {number} len 字符串长度 [0, 256] default 64
 */
function generateRandomString(len?: number): string {
  const MIN_LENGTH = 0;
  const MAX_LENGTH = 256;
  const DEFAULT_LENGTH = 64;
  len = len === undefined ? DEFAULT_LENGTH : len;
  if (typeof len !== "number") throw new Error("字符串长度必须是number类型");
  len = len < MIN_LENGTH ? MIN_LENGTH : len;
  len = len > MAX_LENGTH ? MAX_LENGTH : len;
  let result = "";
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const charactersLength = characters.length;
  let counter = 0;
  while (counter < len) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
    counter += 1;
  }
  return result;
}

export { generateRandomString };
