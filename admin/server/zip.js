// 极简 ZIP 打包器（阶段 K 的「一键导出备份」用）。
//
// 为什么自己写、不装包：后台的依赖尽量少（少一个包就少一处供应链风险、服务器上少一份安装），
// 而我们只需要「把一堆文件塞进一个 zip」这一个功能 —— ZIP 的格式本身很稳定：
//   每个文件 = 本地头 + （压缩后的）数据；最后再写一份中央目录。
// 用 zlib 的 deflateRaw（ZIP 用的就是 raw deflate，不带 zlib 头）。
//
// 支持的写法：**只写**（store / deflate），足够“导出备份”。不做读（解压交给系统工具/用户）。
import zlib from 'node:zlib';

// ——— CRC32（ZIP 每个条目都要）———
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * 打包成 zip（Buffer）。
 * @param {{name: string, data: Buffer|string, compress?: boolean}[]} entries
 *        name 用 `/` 分隔的相对路径；compress 默认 true（小文件压不动也无所谓）
 * @param {{ date?: Date }} [opts] 固定时间戳便于测试（zip 里每个条目都带 mtime）
 */
export function makeZip(entries, opts = {}) {
  const when = opts.date ?? new Date();
  // DOS 时间格式：秒只有 2 秒精度，1980 起算
  const dosTime = ((when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()) & 0xffff;

  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const compress = entry.compress !== false;
    const deflated = compress ? zlib.deflateRawSync(raw, { level: 9 }) : raw;
    // 压不小就别压（ZIP 允许逐个文件选 store/deflate）
    const useDeflate = compress && deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // 本地文件头签名
    local.writeUInt16LE(20, 4); // 需要的版本
    local.writeUInt16LE(0x0800, 6); // 通用位标记：UTF-8 文件名
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); // 压缩后大小
    local.writeUInt32LE(raw.length, 22); // 原始大小
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // 扩展字段长度

    chunks.push(local, name, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); // 中央目录签名
    dir.writeUInt16LE(20, 4); // 创建版本
    dir.writeUInt16LE(20, 6); // 需要版本
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(dosTime, 12);
    dir.writeUInt16LE(dosDate, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30); // 扩展字段
    dir.writeUInt16LE(0, 32); // 注释
    dir.writeUInt16LE(0, 34); // 磁盘号
    dir.writeUInt16LE(0, 36); // 内部属性
    dir.writeUInt32LE(0, 38); // 外部属性
    dir.writeUInt32LE(offset, 42); // 本地头偏移
    central.push(dir, name);

    offset += local.length + name.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // 中央目录结束记录
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // 注释长度

  return Buffer.concat([...chunks, centralBuf, end]);
}
