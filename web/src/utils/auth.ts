/**
 * 将邮箱地址部分隐藏，仅显示前4个字符（不足则显示全部）加一个星号，后跟域名
 * @param email 完整的邮箱地址
 * @returns 隐藏后的邮箱字符串
 */
export function maskEmail(email: string): string {
    // 查找@符号位置
    const atIndex = email.indexOf('@');

    // 如果没有@符号，视为无效邮箱，原样返回
    if (atIndex === -1) return email;

    // 分离用户名和域名（包括@符号）
    const username = email.substring(0, atIndex);
    const domain = email.substring(atIndex);

    // 取用户名前4个字符（不足4个则全部取出）
    const visiblePart = username.substring(0, 4);

    // 拼接结果：可见部分 + 星号 + 域名
    return visiblePart + '*' + domain;
}
/**
 * 如果字符串长度超过5个字符，则保留前2个和最后2个字符，中间用 * 连接
 * @param str 原始字符串
 * @returns 转换后的字符串
 */
export function maskString(str: string): string {
    if (str.length >= 5) {
        const start = str.slice(0, 2);
        const end = str.slice(-2);
        return start + '*' + end;
    }
    return str;
}
/**
 * 提取邮箱字符串的邮箱地址的'@'符号之前的email
 * @param emailStr 包含邮箱地址的字符串
 * @returns 提取出的邮箱地址，如果没有找到则返回原字符串
 */
export function extractEmail(emailStr: string): string {
    if (!emailStr.includes('@')) return emailStr;
    const parts = emailStr.split('@');
    return parts[0] || emailStr;
}
/**
 * 提取邮箱字符串的邮箱地址的'@'符号之后的domain
 * @param emailStr 包含邮箱地址的字符串
 * @returns 提取出的域名，如果没有找到则返回原字符串
 */
export function extractDomain(emailStr: string): string {
    if (!emailStr.includes('@')) return emailStr;
    const parts = emailStr.split('@');
    return parts[1] || emailStr;
}

/**
 * 是否为微信注册时生成的内部占位邮箱（wx_*@wechat.local）。
 * 这类邮箱既收不到验证码，也没有用户可用的密码。
 */
export function isWechatPlaceholderEmail(email?: string | null): boolean {
    return !!email && /@wechat\.local\s*$/i.test(email);
}

/** 简单的邮箱格式校验（与后端 MailAddress 校验保持一致的可用性）。 */
export function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}