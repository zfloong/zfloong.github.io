/**
 * 主导航管理文件
 */

import { fetchData } from './modules/data-service.js';
import { renderSearch, renderNavAndContent } from './modules/renderer.js';
import { bindSearchEvents, bindTabEvents, bindSectionToggleEvents } from './modules/event-handler.js';
import { showLoading, hideLoading, showError, initNetworkListeners } from './modules/error-handler.js';
import { initDeepBg } from './modules/deep-bg.js';
import { initHeroShader } from './modules/hero-shader.js';

async function loadDataAndInit() {
  try {
    showLoading();
    const data = await fetchData();
    initPage(data);
    hideLoading();
  } catch (error) {
    console.error('加载数据失败:', error);
    showError('数据加载失败，请检查网络连接后重试');
  }
}

function initPage(data) {
  renderSearch(data.search);
  renderNavAndContent(data.categories);

  bindSearchEvents(data.search);
  bindTabEvents();
  bindSectionToggleEvents();

  initDeepBg();
  initHeroShader();
}

document.addEventListener('DOMContentLoaded', () => {
  initNetworkListeners();
  loadDataAndInit();
  window.addEventListener('retryFetchData', loadDataAndInit);
});