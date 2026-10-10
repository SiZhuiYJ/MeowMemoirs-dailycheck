/**
 * 将日期转换为 YYYY-MM-DD 格式的字符串
 * @param date 要转换的 Date 对象
 * @return 转换后的日期字符串，格式为 "YYYY-MM-DD"
 */
export function toLocalDateOnlyString(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
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
/**
 * 传入一个数，一个长度使用一个字符或者数字填充到指定长度
 * @param num 要填充的数
 * @param length 目标长度
 * @param fillChar 填充字符（默认是 '0'）
 * @returns 填充后的字符串
 */
export function padNumber(
  num: number,
  length: number,
  fillChar: string = "0",
): string {
  return num.toString().padStart(length, fillChar);
}

/**
 * 获取今天的日期字符串（YYYY-MM-DD）
 * @returns 今天的日期字符串
 */
export function getTodayString(): string {
  return toLocalDateOnlyString(new Date());
}

/**
 * 获取指定月份的每一天
 * @param year 年份
 * @param month 月份（1-12）
 * @return 包含该月每一天的 Date 对象数组
 */
export function getMonthDays(year: number, month: number): Date[] {
  const days: Date[] = [];
  const cursor = new Date(year, month - 1, 1);
  while (cursor.getMonth() === month - 1) {
    days.push(
      new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()),
    );
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/**
 *  判断一个日期是否是今天
 * @param date 日期对象或日期字符串（YYYY-MM-DD）
 * @returns 如果日期是今天返回 true，否则返回 false
 */
export function isToday(date: Date | string): boolean {
  const dateStr = typeof date === "string" ? date : toLocalDateOnlyString(date);
  return dateStr === getTodayString();
}

/**
 * 判断一个日期是否在今天之前
 * @param date 日期对象或日期字符串（YYYY-MM-DD）
 * @returns 如果日期在今天之前返回 true，否则返回 false
 */
export function isPast(date: Date | string): boolean {
  const dateStr = typeof date === "string" ? date : toLocalDateOnlyString(date);
  return dateStr < getTodayString();
}
