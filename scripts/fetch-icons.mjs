/**
 * 图标预取脚本
 * 从 data.json 中提取所有外部图标 URL，下载并本地化，然后重写 data.json
 *
 * 用法：node scripts/fetch-icons.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ICONS_DIR = join(ROOT, 'icons');
const DATA_PATH = join(ROOT, 'data.json');

// ========== 工具函数 ==========

/**
 * 从 URL 提取用于文件名的标识符
 * 优先从 Google favicons 服务的 domain 参数提取
 */
function extractSlug(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'www.google.com' && u.pathname === '/s2/favicons') {
      const domain = u.searchParams.get('domain');
      if (domain) return domain.replace(/\./g, '_');
    }
    let host = u.hostname.replace(/^www\./, '');
    const parts = host.split('.');
    if (parts.length >= 3) {
      host = parts.slice(-3).join('_');
    }
    return host.replace(/\./g, '_');
  } catch {
    return url.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
  }
}

function isExternalUrl(url) {
  return /^https?:\/\//.test(url);
}

/**
 * 按文件头字节认真实格式。URL 里写的后缀经常和实际内容对不上
 * （.ico 的地址返回 png、没后缀的返回 jpeg），只按路径猜会写出假扩展名。
 * @returns {string|null} 扩展名（不含点），认不出返回 null
 */
function sniffKind(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length >= 4 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif';
  if (buffer.length >= 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buffer.length >= 4 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) return 'ico';
  return null;
}

// ========== 核心逻辑 ==========

async function main() {
  console.log('=== 图标预取脚本 ===\n');

  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));

  const iconMap = new Map();
  const collected = [];

  function collect(url) {
    if (!url || !isExternalUrl(url)) return;
    if (iconMap.has(url)) return;
    const slug = extractSlug(url);
    iconMap.set(url, { slug });
    collected.push({ url, slug });
  }

  if (data.search?.quickLinks) {
    for (const link of data.search.quickLinks) collect(link.icon);
  }

  if (data.categories) {
    for (const cat of data.categories) {
      if (cat.sections) {
        for (const sec of cat.sections) {
          if (sec.items) for (const item of sec.items) collect(item.icon);
        }
      }
      if (cat.items) for (const item of cat.items) collect(item.icon);
    }
  }

  console.log(`发现 ${collected.length} 个唯一的外部图标 URL\n`);

  if (!existsSync(ICONS_DIR)) {
    mkdirSync(ICONS_DIR, { recursive: true });
    console.log(`创建目录: icons/\n`);
  }

  // slug → 已有文件名：后缀由上次按字节嗅探决定，这里只按 slug 认，避免重复下载
  const existingFiles = new Map();
  for (const name of readdirSync(ICONS_DIR)) {
    const dot = name.lastIndexOf('.');
    if (dot > 0) existingFiles.set(name.slice(0, dot), name);
  }

  const urlToLocal = {};
  let success = 0, skipped = 0, failed = 0;

  for (const { url, slug } of collected) {
    const hit = existingFiles.get(slug);
    if (hit) {
      console.log(`[跳过] ${url} → icons/${hit}`);
      urlToLocal[url] = `icons/${hit}`;
      skipped++;
      continue;
    }

    try {
      console.log(`[下载] ${url}`);
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GitHubActions/1.0)' },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      let buffer = Buffer.from(await response.arrayBuffer());

      const kind = sniffKind(buffer);
      if (!kind) throw new Error('认不出的图片格式，跳过以免写出假扩展名');

      let outExt = kind;
      if (kind === 'ico') {
        // 能转就转成 png（体积小、缩放稳），转出来的字节确实是 png，后缀跟着改；
        // 转不了就按原始 ico 存，保证后缀与字节一致
        try {
          const sharp = (await import('sharp')).default;
          buffer = await sharp(buffer)
            .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer();
          outExt = 'png';
        } catch { /* 保留原始 ico */ }
      }

      const filename = `${slug}.${outExt}`;
      const outPath = join(ICONS_DIR, filename);
      writeFileSync(outPath, buffer);
      existingFiles.set(slug, filename);
      urlToLocal[url] = `icons/${filename}`;
      console.log(`  → icons/${filename} (${buffer.length} bytes)`);
      success++;
    } catch (err) {
      console.log(`  ✗ 失败: ${err.message}`);
      failed++;
    }
  }

  // 重写 data.json
  console.log(`\n重写 data.json 中的图标路径...`);
  const newData = JSON.parse(JSON.stringify(data));

  function replaceIcon(obj) {
    if (!obj) return;
    if (obj.icon && urlToLocal[obj.icon]) {
      obj.icon = urlToLocal[obj.icon];
    }
  }

  if (newData.search?.quickLinks) newData.search.quickLinks.forEach(replaceIcon);
  if (newData.categories) {
    for (const cat of newData.categories) {
      if (cat.sections) {
        for (const sec of cat.sections) {
          if (sec.items) sec.items.forEach(replaceIcon);
        }
      }
      if (cat.items) cat.items.forEach(replaceIcon);
    }
  }

  writeFileSync(DATA_PATH, JSON.stringify(newData, null, 2) + '\n', 'utf-8');
  console.log('data.json 已更新\n');

  console.log('=== 完成 ===');
  console.log(`  成功下载: ${success}`);
  console.log(`  跳过(已存在): ${skipped}`);
  console.log(`  失败: ${failed}`);
  if (failed > 0) console.log(`\n⚠  ${failed} 个图标下载失败，保留了原始 URL`);
}

main().catch((err) => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
