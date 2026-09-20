/**
 * 图标抓取与暂存
 *
 * 抓下来的图标不写外链，而是存成图片字节、推送时提交进仓库 icons/ —— 外链图标
 * 早晚会失效（对方改版、防盗链），存进自己的仓库才是永久的。
 *
 * 浏览器要读到图片字节就必须走带 CORS 的源，下面三个都是实测返回
 * Access-Control-Allow-Origin: * 的地址；wsrv.nl 是图片代理，顺带把
 * ico / svg / webp 统一转成 png，所以排在最前，icon.horse 兜底（它能给
 * 陌生域名返回一张默认图标，不至于空手而归）。
 *
 * 抓到的图先以 data URL 暂存在 localStorage：卡片立刻能看到图标，推送时
 * 再由 github-push 连同 data.json 一起提交进仓库。
 */

import { listDir, getToken } from './github-push.js';

const PENDING_KEY = 'flyloong_edit_icons';
const ICON_DIR = 'icons';
const INDEX_TTL = 10 * 60 * 1000;   // 仓库图标清单缓存时长

const SOURCES = [
  (host) => `https://wsrv.nl/?url=${encodeURIComponent(`https://www.google.com/s2/favicons?domain=${host}&sz=128`)}&output=png&w=128&h=128`,
  (host) => `https://wsrv.nl/?url=${encodeURIComponent(`https://${host}/favicon.ico`)}&output=png&w=128&h=128`,
  (host) => `https://icon.horse/icon/${host}`,
];

let index = null;   // { at, exact: Map(路径 → 文件), byBase: Map(去掉扩展名 → 路径) }

/* ---------------- 暂存区 ---------------- */

function loadPending() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.error('读取待提交图标失败:', error);
    return {};
  }
}

function savePending(map) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(map));
    return true;
  } catch (error) {
    console.error('暂存图标失败（可能浏览器存储满了）:', error);
    return false;
  }
}

function addPending(path, record) {
  const map = loadPending();
  map[path] = record;
  return savePending(map);
}

function pendingFor(path) {
  return loadPending()[path] || null;
}

/** 待提交的图标，推送时用（已经推进仓库的不算） */
function pendingList() {
  return Object.entries(loadPending())
    .filter(([, record]) => !record.pushed)
    .map(([path, record]) => ({ path, base64: record.base64, dataUrl: record.dataUrl }));
}

/**
 * 推送成功后：图标已经在仓库里了，但本机这份 clone 要 git pull 才会有那些文件，
 * 所以暂存先留着给页面当预览用，只是不再参与下一次提交
 */
function noteIconsPushed(paths) {
  const list = paths || [];
  const map = loadPending();
  list.forEach(path => {
    if (map[path]) map[path].pushed = true;
    if (index) index.byBase.set(baseOf(path), path);
  });
  const pushed = Object.entries(map).filter(([, record]) => record.pushed).sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
  pushed.slice(0, Math.max(0, pushed.length - 40)).forEach(([path]) => { delete map[path]; });   // 别让暂存无限长大
  savePending(map);
}

function clearPending() {
  try { localStorage.removeItem(PENDING_KEY); } catch (error) { console.error('清除待提交图标失败:', error); }
}

/* ---------------- 命名与查重 ---------------- */

function hostOf(url) {
  try {
    const host = new URL(String(url).trim()).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch (error) {
    return '';
  }
}

/** x.com → x_com；dash.cloudflare.com → dash_cloudflare_com（跟仓库里现有图标同名规则一致） */
function baseFor(host) {
  return host.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function baseOf(path) {
  return String(path).replace(`${ICON_DIR}/`, '').replace(/\.[a-z0-9]+$/i, '');
}

async function loadIndex(force) {
  if (!force && index && Date.now() - index.at < INDEX_TTL) return index;
  const files = await listDir(ICON_DIR, getToken());
  const byBase = new Map();
  files.forEach((file, path) => {
    const base = baseOf(path);
    // 同名不同扩展名时优先 png（浏览器里缩放更稳）
    if (!byBase.has(base) || path.endsWith('.png')) byBase.set(base, path);
  });
  index = { at: Date.now(), exact: files, byBase };
  return index;
}

function refreshIndex() {
  return loadIndex(true);
}

/** 仓库里已经有这个域名的图标就直接复用，不重复下载 */
function existingPath(host) {
  if (!index) return null;
  const bare = host.replace(/^www\./, '');
  const candidates = bare === host ? [bare] : [bare, host];
  for (const candidate of candidates) {
    const hit = index.byBase.get(baseFor(candidate));
    if (hit) return hit;
  }
  return null;
}

/* ---------------- 抓取 ---------------- */

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(blob);
  });
}

/**
 * 给一个网址找图标：仓库里已有就复用，否则从带 CORS 的源抓一张存进暂存区
 * @returns {Promise<{path:string, reused:boolean, dataUrl?:string}>}
 */
async function grab(url, token = getToken()) {
  const host = hostOf(url);
  if (!host) throw new Error('网址要填完整（http:// 或 https:// 开头）');

  try {
    await loadIndex(false);
  } catch (error) {
    // 仓库清单读不到（断网 / 限流）不该拦住抓取，抓完照样能在本地看到
    console.warn('读取仓库图标清单失败，跳过查重:', error);
  }
  const reused = existingPath(host);
  if (reused) return { path: reused, reused: true };

  const path = `${ICON_DIR}/${baseFor(host)}.png`;
  for (const makeUrl of SOURCES) {
    try {
      const res = await fetch(makeUrl(host), { mode: 'cors', cache: 'no-store' });
      if (!res.ok) continue;
      const type = res.headers.get('content-type') || '';
      if (!type.startsWith('image/')) continue;
      const blob = await res.blob();
      if (blob.size < 200 || blob.size > 300 * 1024) continue;   // 1×1 的占位图 / 过大的图都不要
      const dataUrl = await blobToDataUrl(blob);
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      if (!addPending(path, { dataUrl, base64, host, at: Date.now() })) {
        throw new Error('浏览器存储满了，先推送或清掉草稿再抓');
      }
      return { path, reused: false, dataUrl };
    } catch (error) {
      if (/存储满/.test(error.message)) throw error;
      // 换下一个源
    }
  }
  throw new Error('这个网站没给可用的图标，可以先留空或手填');
}

/** 已抓到的图标贴回卡片：刷新后 data.json 里的路径还没有对应文件，这里用暂存的图顶上 */
function applyPendingIcons(root = document) {
  const map = loadPending();
  const paths = Object.keys(map);
  if (!paths.length) return;
  root.querySelectorAll('.card img[src]').forEach(img => {
    const src = img.getAttribute('src') || '';
    if (!src.startsWith(`${ICON_DIR}/`)) return;
    const hit = map[src];
    if (hit && hit.dataUrl && img.src !== hit.dataUrl) img.src = hit.dataUrl;
  });
}

export {
  grab, applyPendingIcons,
  pendingList, pendingFor, noteIconsPushed, clearPending, loadPending,
  hostOf, baseFor,
};
