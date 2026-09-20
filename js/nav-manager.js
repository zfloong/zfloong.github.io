/**
 * 主导航管理文件
 */

import { fetchData } from './modules/data-service.js';
import { renderSearch, renderNavAndContent } from './modules/renderer.js';
import { bindSearchEvents, bindTabEvents, bindSectionToggleEvents } from './modules/event-handler.js';
import { showLoading, hideLoading, showError, initNetworkListeners } from './modules/error-handler.js';
import { initDeepBg } from './modules/deep-bg.js';
import { initHeroShader } from './modules/hero-shader.js';
import { initKeyboardNav } from './modules/keyboard-nav.js';
import { loadDraft, clearDraft } from './modules/draft-store.js';

let currentData = null;
let editorApi = null;

/** 键顺序不算差异的排序副本，用来比较两份数据内容是否一致 */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = sortKeys(value[key]);
      return out;
    }, {});
  }
  return value;
}

function sameContent(a, b) {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

async function loadDataAndInit() {
  try {
    showLoading();
    // 本机存了编辑草稿就优先用草稿：要等用户复制/下载并提交后，线上 data.json 才会一致
    const draft = loadDraft();
    let data;
    if (draft) {
      // 本机 data.json 已经和草稿一样（也就是拉取过了）说明文件才是最准的，草稿退场
      const fresh = await fetchData().catch(() => null);
      if (fresh && sameContent(fresh, draft.data)) {
        clearDraft();
        data = fresh;
      } else {
        data = draft.data;
      }
    } else {
      data = await fetchData();
    }
    initPage(data);
    hideLoading();
  } catch (error) {
    console.error('加载数据失败:', error);
    showError('数据加载失败，请检查网络连接后重试');
  }
}

/** 编辑器改完数据后重画分类区，并把用户当前看的分类接回去 */
function rerender() {
  if (!currentData) return;
  const activeTab = document.querySelector('.tab-btn.active');
  const activeId = activeTab ? activeTab.getAttribute('data-target') : null;

  renderNavAndContent(currentData.categories);
  bindTabEvents();
  bindSectionToggleEvents();

  if (activeId) {
    const tab = [...document.querySelectorAll('.tab-btn')].find(t => t.getAttribute('data-target') === activeId);
    if (tab) tab.click();
  }
}

function initPage(data) {
  currentData = data;

  renderSearch(data.search);
  renderNavAndContent(data.categories);

  bindSearchEvents(data.search);
  bindTabEvents();
  bindSectionToggleEvents();

  initDeepBg();
  initHeroShader();
  initKeyboardNav();
}

/** 编辑入口常驻可见，编辑器模块点开时才加载（访客不会下载它） */
function bindEditEntry() {
  const entry = document.getElementById('edit-entry');
  if (!entry) return;
  entry.addEventListener('click', async () => {
    if (!currentData) return;
    if (editorApi) {
      editorApi.toggleEditMode();
      return;
    }
    try {
      editorApi = await import('./modules/editor.js');
      editorApi.initEditor({ entry, getData: () => currentData, rerender });
    } catch (error) {
      console.error('编辑器加载失败:', error);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initNetworkListeners();
  loadDataAndInit();
  bindEditEntry();
  window.addEventListener('retryFetchData', loadDataAndInit);
});
