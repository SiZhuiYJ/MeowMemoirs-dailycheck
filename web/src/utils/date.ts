/**
 * 将日期转换为年月日字符串
 * @param date 日期 格式New Date()
 * @returns 年月日，格式 'yyyy-mm-dd'
 */
export function toLocalDateOnlyString(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 判断date是否为今天
 * @param date 日期 格式New Date()
 * @returns 判断(true or false) boolean
 */
export function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}
/**
 * 字符串格式化日期，输入格式为 "YYYY-MM-DD"，输出为 Date 对象
 * @param input 日期字符串，格式为 "YYYY-MM-DD"
 * @return 解析后的 Date 对象
 */
export function parseDateOnly(input: string): Date {
  const parts = input.split("-");
  const y = Number(parts[0] ?? "0") || 0;
  const m = Number(parts[1] ?? "1") || 1;
  const d = Number(parts[2] ?? "1") || 1;
  return new Date(y, m - 1, d);
}