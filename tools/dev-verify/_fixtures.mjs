/**
 * 验证套件共用的小工具（不是套件本身：文件名以 `_` 开头，run-all 会跳过）。
 */
import zlib from "node:zlib";

/**
 * 生成一张带噪点的 PNG。
 *
 * 为什么要随机噪点（seed）：
 *   · 服务端按**内容哈希**做 fileKey，同一份字节重复上传会命中「幂等复用」分支，
 *     写验证用例时需要能自己决定「是不是同一份字节」，所以内容必须可控且每次可不同；
 *   · 同时验证「同一份字节」的用例又必须是真的同一份字节 —— 用同一个 seed 生成两次即可。
 */
export function makePng(width, height, seed = 0) {
  const crcTable = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    return table;
  })();

  const crc32 = (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB

  const stride = 1 + width * 3;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const p = rowStart + 1 + x * 3;
      raw[p] = (seed + ((x * 7) % 200)) % 256;
      raw[p + 1] = (seed * 3 + ((y * 5) % 150)) % 256;
      raw[p + 2] = 200 - ((x + y) % 120);
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
