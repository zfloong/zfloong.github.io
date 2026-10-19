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

// 抓取链：优先直连站点取高清图，再走 icon.horse 与 wsrv 代理；
// 分辨率统一到 256，免得同一枚 logo 因尺寸不同被判成"变了"
const SOURCES = [
  { url: (host) => `https://${host}/apple-touch-icon.png`, checkGeneric: () => false },
  { url: (host) => `https://${host}/favicon.ico`, checkGeneric: () => false },
  { url: (host) => `https://icon.horse/icon/${host}`, checkGeneric: (buf) => buf.length < 3000 },
  { url: (host) => `https://wsrv.nl/?url=${encodeURIComponent(`https://www.google.com/s2/favicons?domain=${host}&sz=128`)}&output=png&w=256&h=256&fit=contain`, checkGeneric: (buf) => buf.length < 1000 },
  { url: (host) => `https://wsrv.nl/?url=${encodeURIComponent(`https://${host}/favicon.ico`)}&output=png&w=256&h=256&fit=contain`, checkGeneric: () => false },
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

/** 图标文件名基准：按站点域名算，与前端 icon-fetch.js 的 baseFor 同一套规则。
 *  这样每张卡片的图标文件名由它自己的域名唯一决定，多站共用 CDN 前缀
 *  （如 img_alicdn_com.svg 被千问/通义/阿里云共用）也不会再互相覆盖。 */
function baseFor(host) {
  return host.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
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

/** 沿抓取链取一张图标；generic=true 表示仅命中通用兜底占位图 */
async function fetchIcon(host) {
  for (let i = 0; i < SOURCES.length; i += 1) {
    const src = SOURCES[i];
    const targetUrl = typeof src === 'function' ? src(host) : src.url(host);
    try {
      const res = await fetch(targetUrl, {
        signal: AbortSignal.timeout(SOURCE_TIMEOUT),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      });
      if (!res.ok) continue;
      const type = res.headers.get('content-type') || '';
      if (!type.startsWith('image/')) continue;
      let buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 200 || buffer.length > 500 * 1024) continue;
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
      const generic = src.checkGeneric ? src.checkGeneric(buffer) : false;
      return { buffer, ext, generic };
    } catch {
      // 超时 / 网络错误：换下一个源
    }
  }
  return null;
}

async function main() {
  console.log('=== 图标月度刷新 ===\n');

  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));

  // 收集所有"本地图标 + 有效网址"的卡片；iconSymbol（remixicon）不参与
  const cards = [];
  function collect(item) {
    if (!item || typeof item.icon !== 'string') return;
    if (!item.icon.startsWith('icons/')) return;
    if (item.iconSymbol) return;
    const host = hostOf(item.url);
    if (!host) return;
    cards.push({ item, host, canonical: `icons/${baseFor(host)}.png` });
  }

  if (data.search?.quickLinks) data.search.quickLinks.forEach(collect);
  if (data.categories) {
    for (const cat of data.categories) {
      if (cat.sections) for (const sec of cat.sections) (sec.items || []).forEach(collect);
      (cat.items || []).forEach(collect);
    }
  }

  // 同域名只抓一次网络，结果复用到所有引用它的卡片
  const fetchCache = new Map();   // host → got|null
  for (const host of new Set(cards.map((c) => c.host))) {
    fetchCache.set(host, await fetchIcon(host));
  }

  console.log(`共 ${cards.length} 张卡片图标需要检查（${fetchCache.size} 个独立站点）\n`);

  let unchanged = 0, updated = 0, skippedFallback = 0, failed = 0;
  const touchedHosts = new Set();
  // 改名前的旧路径快照：用于收尾删除"已被移走、无人再引用"的旧文件
  const oldPathSnapshot = cards.map((c) => c.item.icon);

  for (const { item, host, canonical } of cards) {
    const absOld = join(ROOT, item.icon);
    const oldBuffer = existsSync(absOld) ? readFileSync(absOld) : null;

    const got = fetchCache.get(host);
    if (!got) {
      console.log(`[保留] ${item.icon}（${host}：所有源都失败/超时）`);
      failed++;
      continue;
    }
    // 同一 host 的多张卡片只计一次结果
    if (touchedHosts.has(host)) {
      item.icon = canonical;
      continue;
    }

    const changed = pixelsChanged(await toPixels(oldBuffer), await toPixels(got.buffer));
    if (oldBuffer && !changed) {
      unchanged++;
      continue;
    }
    if (got.generic) {
      console.log(`[待人工] ${item.icon}（${host}：仅兜底源有结果且与本地不同，可能是通用图标，未覆盖）`);
      skippedFallback++;
      continue;
    }

    writeFileSync(join(ROOT, canonical), got.buffer);
    if (canonical !== item.icon) {
      console.log(`[更新] ${item.icon} → ${canonical}（${host}）`);
    } else {
      console.log(`[更新] ${canonical}（${host}）`);
    }
    item.icon = canonical;
    touchedHosts.add(host);
    updated++;
  }

  // 清理孤儿旧文件：仅限"本次改名移走的旧路径"，且改完后全库无卡片再引用
  const referenced = new Set();
  function mark(item) {
    if (item && typeof item.icon === 'string' && item.icon.startsWith('icons/')) referenced.add(item.icon);
  }
  if (data.search?.quickLinks) data.search.quickLinks.forEach(mark);
  for (const cat of data.categories || []) {
    if (cat.sections) for (const sec of cat.sections) (sec.items || []).forEach(mark);
    (cat.items || []).forEach(mark);
  }
  let removed = 0;
  for (const oldPath of new Set(oldPathSnapshot)) {
    if (referenced.has(oldPath) || !existsSync(join(ROOT, oldPath))) continue;
    rmSync(join(ROOT, oldPath));
    console.log(`[清理] 移走后无人引用的旧文件: ${oldPath}`);
    removed++;
  }

  // 重写 data.json
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');

  console.log('\n=== 完成 ===');
  console.log(`  无变化: ${unchanged}`);
  console.log(`  已更新: ${updated}`);
  console.log(`  仅兜底源疑似变化（未覆盖，待人工）: ${skippedFallback}`);
  console.log(`  抓取失败（保留旧图标）: ${failed}`);
  if (removed > 0) console.log(`  清理孤儿旧文件: ${removed}`);
}

main().catch((err) => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
