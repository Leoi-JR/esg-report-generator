/**
 * zip-utils.ts
 *
 * 基于 yauzl 的流式 ZIP 解压工具。
 * 常量内存消耗，支持大文件（1GB+）。
 *
 * 编码处理：
 *   ZIP 规范中，文件名默认编码为 CP437。中文 Windows/macOS 创建的 ZIP
 *   实际使用 GBK 编码但不设置 UTF-8 标志（bit 11）。
 *   本模块关闭 yauzl 的自动解码（decodeStrings: false），
 *   手动检测 UTF-8 / GBK 并正确解码中文文件名。
 */
import yauzl from 'yauzl';
import iconv from 'iconv-lite';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';

export interface ExtractResult {
  fileCount: number;
  totalSize: number;
}

export interface ExtractOptions {
  /** 解压前清空目标目录（默认 true） */
  clearTarget?: boolean;
  /** 自动剥离 ZIP 内的单一根文件夹包装（默认 true） */
  stripRootFolder?: boolean;
}

/**
 * 解码 ZIP entry 的文件名 Buffer。
 *
 * 策略：
 * 1. bit 11 置位 → UTF-8（ZIP 规范）
 * 2. 尝试 UTF-8 解码，如果结果合法且与原始字节一致 → UTF-8
 * 3. 否则按 GBK 解码（中文 Windows/macOS 的事实标准）
 */
function decodeFileName(rawBuffer: Buffer, generalPurposeBitFlag: number): string {
  const isUtf8Flag = (generalPurposeBitFlag & 0x800) !== 0;

  if (isUtf8Flag) {
    return rawBuffer.toString('utf-8');
  }

  // 尝试 UTF-8：如果 buffer 是合法 UTF-8 且不含替换字符
  const utf8Attempt = rawBuffer.toString('utf-8');
  if (!utf8Attempt.includes('\ufffd') && Buffer.from(utf8Attempt, 'utf-8').equals(rawBuffer)) {
    return utf8Attempt;
  }

  // 回退到 GBK（中文系统 ZIP 的事实标准）
  return iconv.decode(rawBuffer, 'gbk');
}

/**
 * 将 ZIP 文件解压到指定目录。
 *
 * - 流式逐条解压（常量内存）
 * - 正确处理中文文件名（UTF-8 / GBK 自动检测）
 * - 自动剥离根文件夹包装（如 `【xxx】ESG资料收集/`）
 * - 跳过 __MACOSX/ 和 .DS_Store
 * - 路径穿越防护
 */
export async function extractZipToDir(
  zipPath: string,
  targetDir: string,
  options?: ExtractOptions
): Promise<ExtractResult> {
  const { clearTarget = true, stripRootFolder = true } = options ?? {};

  // 清空目标目录
  if (clearTarget) {
    await fsp.rm(targetDir, { recursive: true, force: true });
  }
  await fsp.mkdir(targetDir, { recursive: true });

  // 将目标目录解析为绝对路径用于安全校验
  const resolvedTarget = path.resolve(targetDir);

  return new Promise<ExtractResult>((resolve, reject) => {
    // decodeStrings: false — 关闭 yauzl 自动解码，手动处理编码
    yauzl.open(zipPath, { lazyEntries: true, decodeStrings: false }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('Failed to open ZIP'));

      let fileCount = 0;
      let totalSize = 0;
      let rootPrefix: string | null = null;
      let rootPrefixDetected = false;

      zipfile.readEntry();

      zipfile.on('entry', (entry) => {
        // 手动解码文件名
        const fileNameBuf = entry.fileName as unknown as Buffer;
        let entryPath = decodeFileName(fileNameBuf, entry.generalPurposeBitFlag);

        // 统一路径分隔符（Windows ZIP 可能用反斜杠）
        entryPath = entryPath.replace(/\\/g, '/');

        // 跳过 macOS 元数据
        if (entryPath.startsWith('__MACOSX/') || path.basename(entryPath) === '.DS_Store') {
          zipfile.readEntry();
          return;
        }

        // 跳过 📋说明.txt（模板说明文件，不需要保留）
        if (path.basename(entryPath) === '📋说明.txt') {
          zipfile.readEntry();
          return;
        }

        // 检测根文件夹包装
        if (stripRootFolder && !rootPrefixDetected) {
          rootPrefixDetected = true;
          const firstSlash = entryPath.indexOf('/');
          if (firstSlash > 0) {
            rootPrefix = entryPath.substring(0, firstSlash + 1);
          }
        }

        // 剥离根文件夹前缀
        if (rootPrefix && entryPath.startsWith(rootPrefix)) {
          entryPath = entryPath.substring(rootPrefix.length);
        }

        // 跳过空路径（根文件夹条目本身）
        if (!entryPath) {
          zipfile.readEntry();
          return;
        }

        const fullPath = path.resolve(targetDir, entryPath);

        // 安全：防止路径穿越
        if (!fullPath.startsWith(resolvedTarget)) {
          zipfile.readEntry();
          return;
        }

        // 目录条目
        if (entryPath.endsWith('/')) {
          fsp.mkdir(fullPath, { recursive: true })
            .then(() => zipfile.readEntry())
            .catch(reject);
          return;
        }

        // 文件条目 — 流式写入
        fsp.mkdir(path.dirname(fullPath), { recursive: true })
          .then(() => {
            zipfile.openReadStream(entry, (streamErr, readStream) => {
              if (streamErr || !readStream) {
                reject(streamErr ?? new Error('Failed to read ZIP entry'));
                return;
              }

              const writeStream = fs.createWriteStream(fullPath);

              pipeline(readStream, writeStream)
                .then(() => {
                  fileCount++;
                  totalSize += entry.uncompressedSize;
                  zipfile.readEntry();
                })
                .catch(reject);
            });
          })
          .catch(reject);
      });

      zipfile.on('end', () => resolve({ fileCount, totalSize }));
      zipfile.on('error', reject);
    });
  });
}
