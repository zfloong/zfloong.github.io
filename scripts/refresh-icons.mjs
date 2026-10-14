/**
 * 图标月度刷新脚本
 *
 * 与 fetch-icons.mjs 的分工：fetch-icons 把外链图标本地化；本脚本反过来——
 * 对已本地化的图标，按卡片网址重新抓一遍，像素变了才替换。
 *
 * 安全规则（与在线编辑器同一套）：
 *   · 高置信源（wsrv 代理 Google favicons / 站点 favicon.ico）抓到且像素变了 → 自动更新
 *   · 兜底源 icon.horse 命中 → 不自动覆盖（它给陌生域名发通用图标，静默换错图比不换更糟），只记日志
 *   · 全部源失败 / 超时 → 保留旧图标
 *
 * 比对方式：像素级（双方归一到 64×64 RGBA 再比，2% 容差），不做字节级——
 * 同一枚 logo 按不同尺寸重抓会得到不同字节，字节比对全是误报。
 *
 * 用法：node scripts/refresh-icons.mjs
 */

import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ICONS_DIR = join(ROOT, 'icons');
const DATA_PATH = join(ROOT, 'data.json');

const SOURCE_TIMEOUT = 8000;   // 单源最多 8 秒，与在线编辑器一致

// 与 js/modules/icon-fetch.js 同一条链；分辨率提到 256，和手动粘贴直链的落盘规格一致，
// 免得同一枚 logo 因尺寸不同被判成"变了"
const SOURCES = [
  (host) => `https://wsrv.nl/?url=${encodeURIComponent(`https://www.google.com/s2/favicons?domain=${host}&sz=128`)}&output=png&w=256&h=256&fit=contain`,
  (host) => `https://wsrv.nl/?url=${encodeURIComponent(`https://${host}/favicon.ico`)}&output=png&w=256&h=256&fit=contain`,
  (host) => `https://icon.horse/icon/${host}`,
];

/** 按文件头字节认真实格式，只按路径猜会写出假扩展名 */
function sniffKind(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length >= 4 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif';
  if (buffer.length >= 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buffer.length >= 4 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) return 'ico';
  return null;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 归一化到 64×64 RGBA 原始像素：先 trim 裁掉纯色/透明边距（消除"同一 logo
 * 不同留白/缩放"的管线差异），再 contain 到统一尺寸。
 * 裁切失败（纯色图等）退回原图比对；sharp 解不了的格式（如 ico）返回 null，
 * 调用方把旧图视为"不可比"并照常写入新图（ico→png 的一次性规格化）。
 */
async function toPixels(buffer) {
  if (!buffer) return null;
  const prep = (b, s) => s(b)
    .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer();
  try {
    const sharp = (await import('sharp')).default;
    try {
      const trimmed = await sharp(buffer).trim({ threshold: 24 }).toBuffer();
      return await prep(trimmed, sharp);
    } catch {
      return await prep(buffer, sharp);
    }
  } catch {
    return null;
  }
}

/** 像素比对：任通道差 >24 记为一个不同像素，不同像素占比 >2% 才算"图标变了"（抗重编码噪声） */
function pixelsChanged(a, b) {
  if (!a || !b || a.length !== b.length) return true;
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > 24 || Math.abs(a[i + 1] - b[i + 1]) > 24 ||
        Math.abs(a[i + 2] - b[i + 2]) > 24 || Math.abs(a[i + 3] - b[i + 3]) > 24) diff++;
  }
  return diff / (a.length / 4) > 0.02;
}

/** 沿抓取链取一张图标；generic=true 表示只有兜底源命中 */
async function fetchIcon(host) {
  for (let i = 0; i < SOURCES.length; i += 1) {
    try {
      const res = await fetch(SOURCES[i](host), {
        signal: AbortSignal.timeout(SOURCE_TIMEOUT),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; icon-refresh/1.0)' },
      });
      if (!res.ok) continue;
      const type = res.headers.get('content-type') || '';
      if (!type.startsWith('image/')) continue;
      let buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 200 || buffer.length > 300 * 1024) continue;
      let ext = sniffKind(buffer);
      if (!ext) continue;
      if (ext === 'ico') {
        // 能转就转 png，转不了按原始 ico 存，保证后缀与字节一致
        try {
          const sharp = (await import('sharp')).default;
          buffer = await sharp(buffer)
            .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer();
          ext = 'png';
        } catch { /* 保留原始 ico */ }
      }
      return { buffer, ext, generic: i === SOURCES.length - 1 };
    } catch {
      // 超时 / 网络错误：换下一个源
    }
  }
  return null;
}

async function main() {
  console.log('=== 图标月度刷新 ===\n');

  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));

  // 收集所有"本地图标 + 有效网址"的条目，按图标路径去重（多张卡片可共用同一图标文件）
  // iconSymbol（remixicon 图标）不参与抓取
  const byPath = new Map();   // path → { host, items: [] }
  function collect(item) {
    if (!item || typeof item.icon !== 'string') return;
    if (!item.icon.startsWith('icons/')) return;
    if (item.iconSymbol) return;
    const host = hostOf(item.url);
    if (!host) return;
    if (!byPath.has(item.icon)) byPath.set(item.icon, { host, items: [] });
    byPath.get(item.icon).items.push(item);
  }

  if (data.search?.quickLinks) data.search.quickLinks.forEach(collect);
  if (data.categories) {
    for (const cat of data.categories) {
      if (cat.sections) for (const sec of cat.sections) (sec.items || []).forEach(collect);
      (cat.items || []).forEach(collect);
    }
  }

  console.log(`共 ${byPath.size} 个本地图标需要检查\n`);

  let unchanged = 0, updated = 0, skippedFallback = 0, failed = 0, missing = 0;
  const renames = new Map();   // 旧路径 → 新路径（格式变了才产生）

  for (const [path, { host }] of byPath) {
    const absPath = join(ROOT, path);
    const oldBuffer = existsSync(absPath) ? readFileSync(absPath) : null;
    if (!oldBuffer) missing++;

    const got = await fetchIcon(host);
    if (!got) {
      console.log(`[保留] ${path}（${host}：所有源都失败/超时）`);
      failed++;
      continue;
    }
    const changed = pixelsChanged(await toPixels(oldBuffer), await toPixels(got.buffer));
    if (oldBuffer && !changed) {
      unchanged++;
      continue;
    }
    if (got.generic) {
      console.log(`[待人工] ${path}（${host}：仅兜底源有结果且与本地不同，可能是通用图标，未覆盖）`);
      skippedFallback++;
      continue;
    }

    // 格式可能变（ico→png 等）：后缀跟着真实字节走，引用一并改
    const oldExt = path.slice(path.lastIndexOf('.') + 1);
    let newPath = path;
    if (got.ext !== oldExt) {
      newPath = path.replace(/\.[a-z0-9]+$/i, `.${got.ext}`);
      renames.set(path, newPath);
    }
    writeFileSync(join(ROOT, newPath), got.buffer);
    if (renames.has(path) && oldBuffer) {
      // 旧文件已无人引用（本脚本按路径分组，同一路径的条目一起改）
      rmSync(absPath);
    }
    console.log(`[更新] ${path}${newPath !== path ? ` → ${newPath}` : ''}（${host}）`);
    updated++;
  }

  // 重命名时回写 data.json 里的所有引用
  if (renames.size > 0) {
    function rewrite(item) {
      if (item && renames.has(item.icon)) item.icon = renames.get(item.icon);
    }
    if (data.search?.quickLinks) data.search.quickLinks.forEach(rewrite);
    for (const cat of data.categories || []) {
      if (cat.sections) for (const sec of cat.sections) (sec.items || []).forEach(rewrite);
      (cat.items || []).forEach(rewrite);
    }
    writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }

  console.log('\n=== 完成 ===');
  console.log(`  无变化: ${unchanged}`);
  console.log(`  已更新: ${updated}`);
  console.log(`  仅兜底源疑似变化（未覆盖，待人工）: ${skippedFallback}`);
  console.log(`  抓取失败（保留旧图标）: ${failed}`);
  if (missing > 0) console.log(`  其中本地文件缺失、已按新抓取补齐: ${missing}`);
}

main().catch((err) => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
