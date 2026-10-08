/**
 * 在线编辑（编辑模式）
 *
 * 入口：导航右上角 #edit-entry，点击时由 nav-manager 动态 import 本模块（访客不下载）。
 *
 *   · 卡片可拖（同组内 / 跨组 / 跨分类），分类页签也能拖着换序
 *   · 拖到某个页签上停一下会切到那个分类，于是卡片可以跨分类搬
 *   · 每个分组有 ＋ 加卡片和 ✎ 重命名、每个分类末尾有 ＋ 新增分组、顶部有 ＋ 新增分类
 *   · 点卡片不再跳转，而是弹出表单改名称/网址/图标，或删除
 *   · 图标留空时按网址自动抓一张，存进暂存区，推送时提交进仓库 icons/
 *   · 改动先写进浏览器本地草稿（draft-store），工具条可复制 data.json 内容
 *   · 「推送到 GitHub」直接把 data.json + 新图标提交成一个 commit（github-push）
 *
 * 两条硬约束：
 * 1. 全部节点用 DOM API 构造，不出现 innerHTML —— 面板里存着 GitHub token，
 *    手打进去的字段一旦被当 HTML 解析，等于把仓库写权限递出去；
 * 2. 模块只在点入口时加载，普通访客不下载这段代码。
 */

import { initDragSort, cancelDrag, isDragClickSuppressed } from './drag-sort.js';
import { gridColumnCount } from './renderer.js';
import { loadDraft, saveDraft, clearDraft, toRepoJson, copyText, markPushed, markLocalOnly, draftState } from './draft-store.js';
import { grab, grabFromUrl, applyPendingIcons, pendingFor, pendingList, noteIconsPushed, clearPending } from './icon-fetch.js';
import {
  getToken, setToken, clearToken,
  getBase, setBase,
  verifyToken, readRemoteJson, commitAll,
  REPO_PATH, TOKEN_NEW_URL,
} from './github-push.js';

let entryEl = null;
let ctx = null;          // {getData, rerender}
let bar = null;
let statusEl = null;
let flashTimer = null;
let panel = null;
let backdrop = null;
let panelTitle = null;
let panelBody = null;
let form = null;         // 当前表单 {kind, ...}
let lastFocus = null;    // 打开抽屉前焦点在哪，关掉后还回去
let pushBtnEl = null;    // 工具条上的推送按钮（连接状态变了要改文案）

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(label, cls, onClick) {
  const node = el('button', `edit-btn${cls ? ` ${cls}` : ''}`, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/** 链接分三类：http(s) / 站内相对路径 / 其它协议（不允许保存） */
function urlKind(url) {
  const value = (url || '').trim();
  if (!value) return 'empty';
  if (/^https?:\/\//i.test(value)) return 'http';
  // 协议相对地址（//host）实际指向外站，不能当站内相对路径放行
  if (/^\/[\/\\]/.test(value)) return 'scheme';
  // 去掉空白/控制字符再判一次，堵住 java\tscript: 这类伪协议
  const compact = value.replace(/[\s\u0000-\u001f\u007f]/g, '');
  return /^[a-z][a-z0-9+.-]*:/i.test(compact) ? 'scheme' : 'relative';
}

/**
 * 给网页版 AI 的一句话：让它去站上找图标，并回一个「打开就是图片」的直链。
 * 重点是把「不要给网页地址」写死，否则十有八九会甩回来一个页面链接。
 */
function iconPrompt(siteUrl) {
  const site = (siteUrl || '').trim() || '（网址还没填）';
  return `请访问 ${site} ，帮我找到这个网站的图标（favicon 或站点 logo）。`
    + '给我一个可以直接下载的图片地址：打开就是图片本身（形如 https://…/icon.png），不要给我网页地址。'
    + '尽量正方形、边长 128px 以上，优先 apple-touch-icon 或站点 logo 原图。只回复这一个链接，不要解释。';
}

function catById(data, id) {
  return (data.categories || []).find(c => c.id === id);
}

/** 取分类下某分组的卡片数组；sec 为 null 表示扁平分类的 items */
function itemsArray(cat, sec) {
  if (sec == null) return cat.items || (cat.items = []);
  const section = (cat.sections || [])[sec];
  return section ? (section.items || (section.items = [])) : null;
}

function groupName(cat, sec) {
  if (sec == null) return cat.sectionTitle || cat.navTitle || cat.id;
  const section = (cat.sections || [])[sec];
  return section ? section.name : '';
}

/* ---------------- 表单抽屉 ---------------- */

function buildShell() {
  backdrop = el('div', 'edit-backdrop');
  backdrop.addEventListener('click', () => closeForm());

  panel = el('aside', 'edit-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', '在线编辑');

  const head = el('div', 'edit-head');
  panelTitle = el('div', 'edit-title', '编辑');
  const closeBtn = el('button', 'edit-close', '关闭');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', () => closeForm());
  head.append(panelTitle, closeBtn);

  panelBody = el('div', 'edit-body');

  const foot = el('div', 'edit-foot');
  foot.append(el('span', null, '改动先存在本机草稿里'), el('span', null, 'Esc 关闭'));

  panel.append(head, panelBody, foot);
  document.body.append(backdrop, panel);
}

function openPanel(title) {
  if (!panel) buildShell();
  lastFocus = document.activeElement;
  panelTitle.textContent = title;
  panelBody.replaceChildren();
  document.body.classList.add('edit-open');
  backdrop.classList.add('open');
  panel.classList.add('open');
}

/**
 * 关抽屉。抽屉里填了一半就点遮罩 / 按 Esc / 点「关闭」的话，改动会直接消失，
 * 所以表单自己挂一个 form.dirty()，关之前问一句。
 * force = true 用于"数据已经落地"的路径（保存、删除、主动退出编辑），不再追问。
 */
function closeForm(force) {
  if (!force && form && form.dirty && form.dirty()) {
    if (!window.confirm('抽屉里的改动还没保存，关掉就不生效了。确定要关闭吗？')) return;
  }
  const opener = form ? lastFocus : null;
  form = null;
  if (!panel) return;
  document.body.classList.remove('edit-open');
  backdrop.classList.remove('open');
  panel.classList.remove('open');
  if (opener && opener.isConnected) opener.focus();
}

/** 抽屉里可 Tab 到的元素（抽屉是模态的，Tab 不能跑到后面页面上去） */
function focusables(root) {
  return [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter(node => !node.disabled && node.offsetParent !== null);
}

function field(labelText, value, hint) {
  const wrap = el('div', 'edit-field');
  const input = el('input', 'edit-input');
  input.type = 'text';
  input.value = value || '';
  input.spellcheck = false;
  wrap.append(el('label', 'edit-label', labelText), input);
  if (hint) wrap.append(el('div', 'edit-hint', hint));
  return { wrap, input };
}

function openCardForm(target) {
  const data = ctx.getData();
  const cat = catById(data, target.cat);
  if (!cat) return;
  const isNew = target.idx == null;
  const arr = itemsArray(cat, target.sec);
  if (!arr) return;
  const item = isNew ? null : arr[target.idx];
  if (!isNew && !item) return;

  form = { kind: 'card' };
  openPanel(isNew ? `新增卡片 · ${groupName(cat, target.sec)}` : '编辑卡片');

  const name = field('名称', item ? item.title : '', '卡片上显示的文字');
  const url = field('网址', item ? item.url : '', 'https://… 或站内路径（如 about.html）');
  const icon = field('图标（可选）', item ? item.icon : '', '留空的话推送时按网址自动抓一张；也可填 icons/xxx.png 或 remixicon 类名如 ri-links-line');

  // 预览 + 自动抓取：抓下来的图先存本地，推送时一起提交进仓库 icons/
  const preview = el('img', 'edit-icon-preview');
  preview.alt = '';
  preview.hidden = true;
  preview.addEventListener('error', () => { preview.hidden = true; });
  const grabBtn = button('自动抓取图标', 'mini', onGrab);
  const grabMsg = el('span', 'edit-hint grow', '');
  const iconRow = el('div', 'edit-icon-row');
  iconRow.append(preview, grabBtn, grabMsg);

  // 抓取结果统一走这里：warn 为真就换琥珀色粗体，兜底和失败才用得上
  const setGrabMsg = (text, warn) => {
    grabMsg.textContent = text;
    grabMsg.classList.toggle('warn', !!warn);
  };

  const showPreview = (value) => {
    const path = (value || '').trim();
    if (!path) {
      preview.hidden = true;
      preview.removeAttribute('src');
      return;
    }
    const pending = pendingFor(path);
    preview.hidden = false;
    preview.src = pending ? pending.dataUrl : path;
  };

  icon.input.addEventListener('input', () => showPreview(icon.input.value));
  showPreview(item ? item.icon : '');

  // 跟进来时的值比一比：动过才拦。新增表单全空，没打字就不算脏
  const original = {
    title: ((item && item.title) || '').trim(),
    url: ((item && item.url) || '').trim(),
    icon: ((item && item.icon) || '').trim(),
  };
  form.dirty = () => name.input.value.trim() !== original.title
    || url.input.value.trim() !== original.url
    || icon.input.value.trim() !== original.icon;

  // 兜底图 / 完全抓不到时的补救入口。静态站自己够不着 AI（没有 key 也没有后端），
  // 所以只生成一句话让用户去网页端跑腿；链接拿回来之后的取图、校验、随 data.json
  // 提交进 icons/ 全归我们，用户只需要粘贴 + 保存。
  const promptBox = el('div', 'edit-prompt', '');
  const refreshPrompt = () => { promptBox.textContent = iconPrompt(url.input.value); };
  const rescueTip = el('div', 'edit-hint grow', '抓到的图不对？把下面这句发给能联网的 AI（豆包 / ChatGPT 等），再把它给的图片直链贴回来：');
  const rescueHead = el('div', 'edit-rescue-head');
  rescueHead.append(rescueTip, button('复制这句话', 'mini', onCopyPrompt));
  const linkInput = el('input', 'edit-input');
  linkInput.type = 'text';
  linkInput.spellcheck = false;
  linkInput.placeholder = '粘贴 AI 给的图片直链';
  const useMsg = el('span', 'edit-hint grow', '');
  const useBtn = button('用这张', 'mini', onUseLink);
  const linkRow = el('div', 'edit-icon-row');
  linkRow.append(linkInput, useBtn, useMsg);
  const rescue = el('div', 'edit-rescue');
  rescue.append(rescueHead, promptBox, linkRow);
  rescue.hidden = true;

  const setUseMsg = (text, warn) => {
    useMsg.textContent = text;
    useMsg.classList.toggle('warn', !!warn);
  };
  const showRescue = (on) => {
    rescue.hidden = !on;
    if (on) refreshPrompt();
  };
  // 网址改了就重算提示词，否则 AI 会照着上一个域名找
  url.input.addEventListener('input', () => { if (!rescue.hidden) refreshPrompt(); });

  const error = el('div', 'edit-error');
  panelBody.append(name.wrap, url.wrap, icon.wrap, iconRow, rescue, error);

  // 锁定位置：钉住这张卡片，拖动其他卡片时它不动。
  // 只有已有卡片能锁（新增的还没位置，锁了没意义）。
  let lockWrap = null;
  if (!isNew) {
    lockWrap = el('label', 'edit-field edit-check');
    const lockInput = el('input', 'edit-check-input');
    lockInput.type = 'checkbox';
    lockInput.checked = !!item.locked;
    const lockLabel = el('span', null, '锁定位置（拖动其他卡片时这张不动）');
    lockWrap.append(lockInput, lockLabel);
    panelBody.insertBefore(lockWrap, error);
    // 锁定状态也算脏
    const origLocked = !!item.locked;
    form.dirty = () => name.input.value.trim() !== original.title
      || url.input.value.trim() !== original.url
      || icon.input.value.trim() !== original.icon
      || lockInput.checked !== origLocked;
  }

  // 从 DOM 位置算 pos：第 n 行第 m 列 → n * cols + m
  function posFromWrap(wrap) {
    const grid = wrap && wrap.closest('.grid');
    if (!grid) return null;
    const cols = gridColumnCount(grid);
    if (cols < 1) return null;
    const r = wrap.getBoundingClientRect();
    const gr = grid.getBoundingClientRect();
    const col = Math.round((r.left - gr.left) / r.width);
    const row = Math.round((r.top - gr.top) / r.height);
    return row * cols + Math.max(0, Math.min(col, cols - 1));
  }

  async function onCopyPrompt() {
    refreshPrompt();
    const ok = await copyText(promptBox.textContent);
    setUseMsg(ok ? '已复制，去网页端粘贴' : '复制失败：浏览器没给剪贴板权限，手动选中上面那段也行', !ok);
  }

  async function onUseLink() {
    const link = linkInput.value.trim();
    if (!link) { setUseMsg('先粘贴一个图片直链', true); return; }
    useBtn.disabled = true;
    setUseMsg('取图中…', false);
    try {
      const got = await grabFromUrl(link, url.input.value);
      icon.input.value = got.path;
      showPreview(got.path);
      setGrabMsg('');
      setUseMsg(`已用这张（${got.path}），推送时一起提交`, false);
    } catch (err) {
      setUseMsg(err.message, true);
    } finally {
      useBtn.disabled = false;
    }
  }

  async function onGrab() {
    const raw = url.input.value.trim();
    if (urlKind(raw) !== 'http') { setGrabMsg('先把网址填成 http(s) 开头的完整地址', true); return; }
    grabBtn.disabled = true;
    setGrabMsg('抓取中…', false);
    try {
      const got = await grab(raw);
      icon.input.value = got.path;
      showPreview(got.path);
      // 这一次是兜底图才需要补救入口；换成好图之后要收回去，别一直杵在那
      const needRescue = !got.reused && !!got.generic;
      showRescue(needRescue);
      if (got.reused) setGrabMsg('仓库里已经有这张图标了，直接用');
      else if (needRescue) setGrabMsg('只从兜底服务拿到一张通用图标，多半不是这个网站的，建议换一张', true);
      else setGrabMsg('已抓到，推送时和 data.json 一起提交');
    } catch (err) {
      setGrabMsg(err.message, true);
      showRescue(true);   // 一张都没抓到的时候，这条路最有用
    } finally {
      grabBtn.disabled = false;
    }
  }

  const actions = el('div', 'edit-actions');
  if (!isNew) {
    actions.append(button('删除', 'danger', () => {
      if (!window.confirm(`删除「${item.title || '这张卡片'}」？`)) return;
      // 删卡片不补位：原位留空，保持布局的有意留白。
      // 空位不能直接删，想去掉只能拖张卡片填进去。
      arr.splice(target.idx, 1, { type: 'spacer' });
      pruneTrailingSpacers(arr);
      closeForm(true);
      applyChange();
    }));
  }
  actions.append(button('取消', '', () => closeForm()));
  actions.append(button('保存', 'primary', () => {
    const title = name.input.value.trim();
    const value = url.input.value.trim();
    const iconValue = icon.input.value.trim();
    if (!title) { error.textContent = '名称不能为空'; return; }
    if (!value) { error.textContent = '网址不能为空'; return; }
    if (urlKind(value) === 'scheme') { error.textContent = '网址只支持 http(s) 或站内相对路径'; return; }

    let saved = item;
    if (isNew) {
      saved = { title, url: value };
      if (iconValue) saved.icon = iconValue;
      arr.push(saved);
    } else {
      item.title = title;
      item.url = value;
      if (iconValue) item.icon = iconValue;
      else delete item.icon;
      // 锁定 / 解锁：锁定时记下当前格子坐标，解锁时清掉
      const lockInput = lockWrap ? lockWrap.querySelector('input') : null;
      const wantLocked = lockInput ? lockInput.checked : false;
      if (wantLocked && !item.locked) {
        const pos = posFromWrap(target.wrap);
        if (pos != null) { item.locked = true; item.pos = pos; }
      } else if (!wantLocked && item.locked) {
        delete item.locked;
        delete item.pos;
      }
    }
    closeForm(true);
    applyChange();
    // 没填图标就按网址抓一张（抓不到也不拦着，只是没图标）。
    // 用 iconSymbol（remixicon 类名）的卡片不算"没图标"，别抓张图给它盖掉。
    if (!saved.icon && !saved.iconSymbol && urlKind(saved.url) === 'http') autoIcon(saved);
  }));
  panelBody.append(actions);
  name.input.focus();
}

/** 表单关掉之后接着抓图标，抓到再贴回那张卡片 */
async function autoIcon(target) {
  try {
    const got = await grab(target.url);
    if (target.icon || target.iconSymbol || !stillInData(target)) return;
    target.icon = got.path;
    applyChange();
    flash(got.reused ? `已套用仓库里现成的 ${got.path}`
      : got.generic ? '只抓到兜底图，可能不是这个站的图标；再点开这张卡片可以换成 AI 找的图'
        : '已抓取图标，推送时一起提交');
  } catch (error) {
    flash(`图标没抓到（${error.message}）`);
  }
}

function stillInData(target) {
  return (ctx.getData().categories || []).some(cat => {
    const lists = [cat.items, ...(cat.sections || []).map(section => section.items)];
    return lists.some(list => Array.isArray(list) && list.includes(target));
  });
}

function openGroupForm(catId) {
  const data = ctx.getData();
  const cat = catById(data, catId);
  if (!cat || !Array.isArray(cat.sections)) return;

  form = { kind: 'group' };
  openPanel(`新增分组 · ${cat.navTitle || cat.id}`);

  const name = field('分组名称', '', '例如：研习之路');
  const error = el('div', 'edit-error');
  panelBody.append(name.wrap, error);
  form.dirty = () => name.input.value.trim() !== '';

  const actions = el('div', 'edit-actions');
  actions.append(button('取消', '', () => closeForm()));
  actions.append(button('保存', 'primary', () => {
    const value = name.input.value.trim();
    if (!value) { error.textContent = '分组名称不能为空'; return; }
    cat.sections.push({ name: value, items: [] });
    closeForm(true);
    applyChange();
  }));
  panelBody.append(actions);
  name.input.focus();
}

/** 重命名已有分组：只动 section.name，卡片和位置都不碰。
 *  代价是这一组在 localStorage 里的折叠状态按旧名字存的，改完会回到展开（见 renderer.js）。 */
function openRenameGroupForm(catId, secIndex) {
  const data = ctx.getData();
  const cat = catById(data, catId);
  const section = cat && (cat.sections || [])[secIndex];
  if (!section) return;

  form = { kind: 'group' };
  openPanel(`重命名分组 · ${cat.navTitle || cat.id}`);

  const original = section.name;
  const name = field('分组名称', original, '例如：研习之路');
  const error = el('div', 'edit-error');
  panelBody.append(name.wrap, error);
  form.dirty = () => name.input.value.trim() !== original;

  const actions = el('div', 'edit-actions');
  actions.append(button('取消', '', () => closeForm()));
  actions.append(button('保存', 'primary', () => {
    const value = name.input.value.trim();
    if (!value) { error.textContent = '分组名称不能为空'; return; }
    if (value === original) { closeForm(true); return; }
    section.name = value;
    closeForm(true);
    applyChange();
  }));
  panelBody.append(actions);
  name.input.focus();
  name.input.select();
}

function nextCategoryId(data) {
  const used = new Set((data.categories || []).map(c => c.id));
  let n = 1;
  while (used.has(`cat-${n}`)) n += 1;
  return `cat-${n}`;
}

function openCategoryForm() {
  const data = ctx.getData();
  form = { kind: 'category' };
  openPanel('新增分类');

  const name = field('分类名称', '', '显示在顶部页签上，例如：AI 工具');
  const icon = field('图标（可选）', '', 'remixicon 类名，例如 ri-robot-line；留空用 ri-folder-line');
  const error = el('div', 'edit-error');
  panelBody.append(name.wrap, icon.wrap, error);
  form.dirty = () => name.input.value.trim() !== '' || icon.input.value.trim() !== '';

  const actions = el('div', 'edit-actions');
  actions.append(button('取消', '', () => closeForm()));
  actions.append(button('保存', 'primary', () => {
    const value = name.input.value.trim();
    const iconValue = icon.input.value.trim();
    if (!value) { error.textContent = '分类名称不能为空'; return; }
    const id = nextCategoryId(data);
    data.categories.push({
      id,
      navTitle: value,
      icon: iconValue || 'ri-folder-line',
      sections: [{ name: '默认分组', items: [] }],
    });
    closeForm(true);
    applyChange();
    activateCategory(id);
  }));
  panelBody.append(actions);
  name.input.focus();
}

function activateCategory(id) {
  const tab = [...document.querySelectorAll('.tab-btn')].find(t => t.getAttribute('data-target') === id);
  if (tab) tab.click();
}

/* ---------------- 推送到 GitHub ---------------- */

/**
 * 推送抽屉：先给一份「要提交什么」的只读清单（不需要 token 就能读公开仓库），
 * 确认后才提交 —— token 只在这台电脑的浏览器里，换台电脑要重新粘一次。
 */
function openPushPanel() {
  form = { kind: 'push' };
  openPanel('推送到 GitHub');
  renderPush();
}

function renderPush() {
  const token = getToken();
  panelBody.replaceChildren();

  const conn = el('div', 'edit-conn');
  conn.append(el('div', 'edit-conn-title', token ? '已连接 GitHub' : '还没连接 GitHub'));
  if (token) {
    conn.append(el('div', 'edit-conn-sub', `仓库 ${REPO_PATH} · token 只存在这台电脑的浏览器里，随时可以在 GitHub 上撤销`));
    const row = el('div', 'edit-actions');
    row.append(button('断开连接', 'danger', onDisconnect));
    conn.append(row);
  } else {
    const tok = field('GitHub token', '', '在 GitHub 生成一个 fine-grained token：Repository access 只选 zfloong.github.io，权限给 Contents = Read and write');
    tok.input.type = 'password';   // 免得 token 明晃晃挂在屏幕上被截图带走
    tok.input.autocomplete = 'off';
    const link = el('a', 'edit-link', '去 GitHub 生成 token →');
    link.href = TOKEN_NEW_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    tok.wrap.append(link);
    const err = el('div', 'edit-error');
    const row = el('div', 'edit-actions');
    row.append(button('保存并验证', 'primary', async () => {
      const value = tok.input.value.trim();
      if (!value) { err.textContent = '把 token 粘贴进来'; return; }
      err.textContent = '验证中…';
      try {
        const info = await verifyToken(value);
        setToken(value);
        flash(`已连接 GitHub：@${info.login}`);
        updateBar();
        renderPush();
        if (!info.canWrite) flash('连上了，但这个 token 好像没有写权限，推送时会被拒');
      } catch (error) {
        err.textContent = error.message;
      }
    }));
    conn.append(tok.wrap, err, row);
  }
  panelBody.append(conn);

  const summary = el('div', 'edit-conn');
  summary.append(el('div', 'edit-conn-title', '本次要提交的内容'));
  const summaryText = el('div', 'edit-conn-sub', '检查中…');
  summary.append(summaryText);
  panelBody.append(summary);

  const message = field('提交信息', '更新 data.json（在线编辑）');
  panelBody.append(message.wrap);

  const out = el('div', 'edit-error');
  const row = el('div', 'edit-actions');
  row.append(button('取消', '', () => closeForm()));
  // 推不上去时的退路容器，平时是空的，失败了才往里填东西
  const fallback = el('div', 'edit-fallback');
  const go = button('推送', 'primary', () => onPush({ go, out, message, fallback }));
  row.append(go);
  panelBody.append(out, row, fallback);

  message.input.focus();
  precheck(summaryText, go);
}

/** 只读预检：线上现在是什么版本、这次会新增几个图标 */
async function precheck(summaryText, go) {
  const pending = pendingList();
  const icons = pending.length ? `，新增 ${pending.length} 个图标：${pending.map(item => item.path.replace('icons/', '')).join('、')}` : '，没有新图标';
  try {
    const remote = await readRemoteJson();
    const base = getBase();
    if (base && base !== remote.sha) {
      summaryText.textContent = `线上 data.json 已经变过（你看的版本 ${base.slice(0, 7)}，现在 ${remote.sha.slice(0, 7)}）${icons}`;
      go.dataset.conflict = '1';
    } else {
      summaryText.textContent = `data.json（线上 ${remote.sha.slice(0, 7)}）${icons}`;
    }
  } catch (error) {
    summaryText.textContent = `读不到线上 data.json：${error.message}${icons}`;
  }
}

async function onPush({ go, out, message, fallback }) {
  if (!getToken()) { out.textContent = '先在上面粘贴 token 连上 GitHub'; return; }
  const conflict = go.dataset.conflict === '1';
  if (conflict && !window.confirm('线上 data.json 已经被改过，继续推送会覆盖线上的改动。确定要覆盖吗？')) return;
  if (!getBase() && !window.confirm('没能确认线上版本（可能进编辑器时断网了），继续推送可能覆盖别人的改动。确定要推送吗？')) return;

  go.disabled = true;
  out.textContent = '提交中…';
  if (fallback) fallback.replaceChildren();
  try {
    const result = await commitAll({
      message: message.input.value.trim() || '更新 data.json（在线编辑）',
      jsonText: toRepoJson(ctx.getData()),
      icons: pendingList().map(item => ({ path: item.path, base64: item.base64 })),
      expectedSha: conflict ? null : getBase(),
    });
    // 草稿留着不清：本机 clone 里的 data.json 要 git pull 才会更新，清掉草稿
    // 页面会退回旧文件，看起来像刚推的东西丢了。但**必须**标成已推送 ——
    // 否则退出编辑模式时它会被当成"未提交的草稿"，刚推完就自己打自己脸。
    saveDraft(ctx.getData(), getBase());
    markPushed(result.commit);
    noteIconsPushed(result.icons);
    updateBar();
    renderPushed(result);
  } catch (error) {
    out.textContent = error.message;
    go.disabled = false;
    if (fallback) renderPushFallback(fallback);
  }
}

/**
 * 推不上去时给出口，别把改动卡死在草稿里。
 * 这个站可能还有别人在用，不是谁都有仓库权限 —— 让他自己拿走文件、自己决定怎么用，
 * 之后也别再拿"未提交的草稿"催他。
 */
function renderPushFallback(fallback) {
  fallback.replaceChildren();
  fallback.append(el('div', 'edit-hint', '推不上去也不要紧 —— 改动可以只留在这台设备上自己用：'));
  const row = el('div', 'edit-actions');
  row.append(
    button('改用本机保存', 'primary', onUseLocalOnly),
    button('留在编辑里', '', () => fallback.replaceChildren()),
  );
  fallback.append(row);
}

function onUseLocalOnly() {
  if (!window.confirm(
    '改用本机保存后：\n'
    + '· 这次改动只留在这台设备上，不会提交到 GitHub\n'
    + '· 页面继续显示你改的内容\n'
    + '· 顶部不再提示"未提交的草稿"\n'
    + '· 我会把 data.json 下载给你，怎么用你自己定\n\n'
    + '确定吗？'
  )) return;
  markLocalOnly();
  downloadJson();
  closeForm(true);
  exitEditMode();
  showResultNotice({
    tone: 'local',
    title: '改动已保存到你的电脑',
    sub: 'data.json 已下载。本页继续显示这份内容，之后不再提示未提交草稿。想推到 GitHub 时，再点「编辑」→「推送到 GitHub」就行。',
  });
}

/** 把当前数据按仓库格式存成 data.json 下载下来 —— 推送失败时的退路，用户自己拿去用 */
function downloadJson() {
  const blob = new Blob([toRepoJson(ctx.getData())], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'data.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 推送成功的收尾：抽屉原地变成功态 → 自动收起 → 自动退出编辑模式 → 顶部一条持久提示。
 * 不留「关闭」按钮让人手点 —— 这四步是一个动作，做完了就该把他送回正常浏览状态。
 */
function renderPushed(result) {
  const short = result.commit.slice(0, 7);
  const extra = result.icons.length ? ` · 新增 ${result.icons.length} 个图标` : '';

  panelTitle.textContent = '推送完成';
  panelBody.replaceChildren();
  const box = el('div', 'edit-conn');
  box.append(
    el('div', 'edit-conn-title', '✅ 已提交到 GitHub'),
    el('div', 'edit-conn-sub', `提交 ${short}${extra}`),
    el('div', 'edit-hint', '正在退出编辑模式…'),
  );
  const link = el('a', 'edit-link', '在 GitHub 上看这次提交 →');
  link.href = result.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  box.append(link);
  panelBody.append(box);
  flash('已推送');

  setTimeout(() => {
    closeForm(true);
    exitEditMode();
    showResultNotice({
      tone: 'ok',
      title: '✅ 已推送到 GitHub',
      sub: `提交 ${short}${extra} · GitHub Pages 正在重建，通常 1-5 分钟生效，最长可能 10 分钟。生效前这一页显示的仍是你刚提交的内容。`,
      link: { href: result.url, text: '查看提交 →' },
      actions: [{ label: '继续编辑', onClick: () => { clearResultNotice(); enterEditMode(); } }],
    });
  }, 1200);
}

/* ---------------- 顶部持久提示条 ---------------- */
/* flash() 那套 4 秒就消失的文案只适合"复制好了"这种小事；
   推送结果、进入编辑模式这类要人看清的消息得留在页面上，等人自己收起。 */

let noticeEl = null;

function clearResultNotice() {
  if (noticeEl) {
    noticeEl.remove();
    noticeEl = null;
  }
}

function noticeBtn(label, cls, onClick) {
  const node = el('button', `edit-bar-btn${cls ? ` ${cls}` : ''}`, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function showResultNotice({ tone = 'ok', title, sub, link = null, actions = [], autoHideMs = 0 }) {
  clearResultNotice();
  const host = document.querySelector('.main-content');
  if (!host) return;

  const notice = el('div', `result-notice tone-${tone}`);
  const text = el('div', 'draft-notice-text');
  text.append(el('strong', null, title));
  if (sub) text.append(el('span', null, sub));
  notice.append(text);

  if (link) {
    const a = el('a', 'edit-link', link.text);
    a.href = link.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    notice.append(a);
  }
  actions.forEach((act) => notice.append(noticeBtn(act.label, act.cls || '', act.onClick)));
  notice.append(noticeBtn('知道了', '', clearResultNotice));

  noticeEl = notice;
  host.insertBefore(notice, host.firstChild);
  if (autoHideMs) setTimeout(clearResultNotice, autoHideMs);
}

function onDisconnect() {
  if (!window.confirm('断开后要重新粘贴 token 才能推送，确定断开吗？')) return;
  clearToken();
  updateBar();
  renderPush();
  flash('已断开 GitHub');
}

/* ---------------- 编辑模式 ---------------- */

/** 往现有 DOM 上挂编辑态装饰：分组 ＋ 加卡片 / ✎ 重命名、分类 ＋、顶部 ＋ 新增分类 */
function decorate() {
  if (!document.body.classList.contains('edit-mode')) return;

  document.querySelectorAll('.category-section .section-group-title').forEach(title => {
    const section = title.closest('.category-section');
    const si = Number(title.dataset.sec);
    if (!section || !Number.isFinite(si)) return;
    const add = el('button', 'sec-add', '＋');
    add.type = 'button';
    add.title = '在这个分组里加一张卡片';
    add.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openCardForm({ cat: section.id, sec: si, idx: null });
    });
    // 重命名入口：和 ＋ 并排。分组标题本身点击是折叠/展开，所以这里同样要 stopPropagation
    const rename = el('button', 'sec-rename');
    rename.type = 'button';
    rename.title = '重命名这个分组';
    const pen = el('i', 'ri-edit-line');
    pen.setAttribute('aria-hidden', 'true');
    rename.append(pen);
    rename.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openRenameGroupForm(section.id, si);
    });
    title.append(add, rename);
  });

  // 扁平分类没有分组标题，加卡片入口挂在分类区顶部那条 section-header 上
  document.querySelectorAll('.category-section .section-header').forEach(header => {
    const section = header.closest('.category-section');
    if (!section) return;
    const add = el('button', 'sec-add', '＋');
    add.type = 'button';
    add.title = '在这个分类里加一张卡片';
    add.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openCardForm({ cat: section.id, sec: null, idx: null });
    });
    header.appendChild(add);
  });

  ctx.getData().categories.forEach(cat => {
    if (!Array.isArray(cat.sections)) return;
    const section = document.getElementById(cat.id);
    if (!section) return;
    const add = el('button', 'edit-add-group', '＋ 新增分组');
    add.type = 'button';
    add.addEventListener('click', () => openGroupForm(cat.id));
    section.appendChild(add);
  });

  const tabs = document.querySelector('.nav-tabs');
  if (tabs) {
    const add = el('button', 'edit-add-cat', '＋');
    add.type = 'button';
    add.title = '新增一个分类';
    add.addEventListener('click', openCategoryForm);
    tabs.appendChild(add);
  }

  // 还没推送的图标（data.json 里写的路径仓库里还没有）先用本地暂存的图顶上
  applyPendingIcons();
}

function buildBar() {
  statusEl = el('span', 'edit-bar-status', '');
  const mk = (label, cls, fn) => {
    const node = el('button', `edit-bar-btn${cls ? ` ${cls}` : ''}`, label);
    node.type = 'button';
    node.addEventListener('click', fn);
    return node;
  };
  pushBtnEl = mk('推送到 GitHub', 'primary', openPushPanel);
  bar = el('div', 'edit-bar');
  bar.append(
    statusEl,
    pushBtnEl,
    mk('复制 data.json', '', onCopy),
    mk('放弃草稿', 'danger', onDiscard),
    // 叫「完成」容易被读成"保存/提交"，但它只是退出编辑模式，什么都不推
    mk('退出编辑', '', exitEditMode),
  );
  document.body.appendChild(bar);
}

function flash(message) {
  if (!statusEl) return;
  statusEl.textContent = message;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(updateBar, 4000);
}

function updateBar() {
  if (!statusEl) return;
  if (pushBtnEl) {
    const connected = !!getToken();
    pushBtnEl.textContent = connected ? '推送到 GitHub' : '连接 GitHub 推送';
    pushBtnEl.classList.toggle('ok', connected);
  }
  const draft = loadDraft();
  if (!draft) {
    statusEl.textContent = '拖动卡片或页签可排序，点卡片改名称/网址';
    return;
  }
  const t = new Date(draft.savedAt);
  const pad = (n) => String(n).padStart(2, '0');
  const when = `${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
  // 状态写在最前面：用户一眼要知道的是"推没推"，而不是"存没存"
  statusEl.textContent = {
    draft: `草稿已存本机 · 未推送 · ${when}`,
    pushed: `已推送 · ${when}`,
    local: `本机保存 · ${when}`,
  }[draftState(draft)] || `草稿已存本机 · ${when}`;
}

async function onCopy() {
  const ok = await copyText(toRepoJson(ctx.getData()));
  flash(ok ? '已复制，粘贴覆盖仓库里的 data.json 即可' : '复制失败：浏览器没给剪贴板权限，允许后重试');
}

function onDiscard() {
  if (!window.confirm('放弃本机草稿，回到线上 data.json？')) return;
  clearDraft();
  clearPending();
  location.reload();
}

function enterEditMode() {
  document.body.classList.add('edit-mode');
  entryEl.classList.add('on');   // 入口钮没有文字了，进编辑模式只靠这个 .on 着色
  if (!bar) buildBar();
  updateBar();
  decorate();
  // 进来第一件事是告诉用户"你现在能干什么"，而不是让他自己摸。
  // 10 秒后自动淡出，不长期占地方；工具条上的状态文案一直在，想看随时在。
  showResultNotice({
    tone: 'edit',
    title: '已进入编辑模式',
    sub: '拖动卡片或页签可排序。点卡片改名称、网址、图标 改动先存在本机草稿，推送到 GitHub 之后才会提交。',
    autoHideMs: 3000,
  });
}

function exitEditMode() {
  closeForm(true);
  cancelDrag();
  document.body.classList.remove('edit-mode');
  entryEl.classList.remove('on');
  if (bar) {
    bar.remove();
    bar = null;
    statusEl = null;
    pushBtnEl = null;
  }
  ctx.rerender();   // 重建 DOM，去掉加号与拖动标记
  // 停在页面上接着看时，按加载时同一套规则把草稿状态摆出来，不必等刷新
  ctx.refreshDraftNotice();
}

/**
 * 记下当前草稿是基于哪个线上版本做的：推送前拿它和线上比对，
 * 线上被别的设备（或 GitHub 网页端）改过就先提示，不闷头覆盖
 */
async function syncBase() {
  const draft = loadDraft();
  if (draft && draft.baseSha) { setBase(draft.baseSha); return; }
  try {
    const remote = await readRemoteJson();
    setBase(remote.sha);
  } catch (error) {
    console.warn('读线上版本失败，推送时会再确认一次:', error);
  }
}

function toggleEditMode() {
  if (document.body.classList.contains('edit-mode')) exitEditMode();
  else enterEditMode();
}

/* ---------------- 数据改动 ---------------- */

function applyChange() {
  saveDraft(ctx.getData(), getBase());
  ctx.rerender();
  decorate();
  updateBar();
}

/** 把"第 n 个非锁定项"的序号转换成数组下标。
 *  drag-sort 计算 to.idx 时排除了锁定卡片，但包含空位（空位也是 .card-wrap），
 *  所以这里也要包含空位，只跳过锁定卡片，否则下标会错位、拖到空位上填不进去。 */
function nonLockedIndex(arr, n) {
  let count = 0;
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (item && !item.locked) {
      if (count === n) return i;
      count += 1;
    }
  }
  return arr.length;
}

function moveCard(from, to) {
  const data = ctx.getData();
  const fromCat = catById(data, from.cat);
  const toCat = catById(data, to.cat);
  if (!fromCat || !toCat) return;
  const fromArr = itemsArray(fromCat, from.sec);
  const toArr = itemsArray(toCat, to.sec);
  if (!fromArr || !toArr || from.idx >= fromArr.length) return;

  const [item] = fromArr.splice(from.idx, 1);

  // to.idx 是"第几个非锁定卡片"，需要还原成数组下标（锁定卡片不参与排序）
  const toArrIdx = nonLockedIndex(toArr, to.idx);

  if (toArr[toArrIdx] && toArr[toArrIdx].type === 'spacer') {
    toArr.splice(toArrIdx, 1, item);   // 目标是空位 → 填入
  } else {
    toArr.splice(toArrIdx, 0, item);   // 否则插入，后面顺位后移
  }

  // 不补 spacer：拖走就移走，后面的卡片自动前移填位。
  // 之前每次拖动都在源位置补一个 spacer，但中间的 spacer 永远不会被清理，
  // 拖几次就攒一堆，把 grid 布局搞乱、卡片点不动。
  pruneTrailingSpacers(fromArr);
  if (fromArr !== toArr) pruneTrailingSpacers(toArr);
}

/** 去掉数组末尾连续的空位项：尾部空位不产生有意的留白，只会撑出空行 */
function pruneTrailingSpacers(arr) {
  while (arr.length && arr[arr.length - 1] && arr[arr.length - 1].type === 'spacer') {
    arr.pop();
  }
}

function moveTab(from, to) {
  const categories = ctx.getData().categories;
  if (from.idx >= categories.length) return;
  const [cat] = categories.splice(from.idx, 1);
  categories.splice(Math.min(to.idx, categories.length), 0, cat);
}

function handleReorder(move) {
  if (move.kind === 'card') moveCard(move.from, move.to);
  else moveTab(move.from, move.to);
  applyChange();
}

/* ---------------- 事件 ---------------- */

function onEditClick(e) {
  if (!document.body.classList.contains('edit-mode')) return;
  if (isDragClickSuppressed()) return;
  const card = e.target.closest('.card');
  if (!card) return;
  e.preventDefault();
  e.stopPropagation();
  const wrap = card.closest('.card-wrap');
  if (!wrap) return;
  openCardForm({
    cat: wrap.dataset.cat,
    sec: wrap.dataset.sec === undefined ? null : Number(wrap.dataset.sec),
    idx: Number(wrap.dataset.idx),
    wrap,   // 锁定时要从 DOM 位置算 pos
  });
}

function onKeydown(e) {
  if (!form) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeForm();
    return;
  }
  if (e.key !== 'Tab') return;
  // 焦点锁：抽屉打开时 Tab / Shift+Tab 在抽屉内部循环，不会跑到后面的页面上
  const list = focusables(panel);
  if (!list.length) return;
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !panel.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

function initEditor(options) {
  entryEl = options.entry;
  ctx = { getData: options.getData, rerender: options.rerender, refreshDraftNotice: options.refreshDraftNotice };
  initDragSort({ onReorder: handleReorder });
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('click', onEditClick, true);
  syncBase();
  enterEditMode();
}

export { initEditor, toggleEditMode };
