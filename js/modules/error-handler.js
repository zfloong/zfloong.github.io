/**
 * 错误处理模块
 * 处理加载状态和错误提示
 */

/**
 * 显示加载状态
 * 在页面中央显示加载动画
 */
function showLoading() {
  if (document.querySelector('.main-content')) {
    // 检查是否已经存在加载元素
    let loadingElement = document.getElementById('loading-indicator');
    if (!loadingElement) {
      loadingElement = document.createElement('div');
      loadingElement.id = 'loading-indicator';
      loadingElement.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: var(--card-bg);
        padding: 20px;
        border-radius: 10px;
        box-shadow: var(--shadow);
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 10px;
      `;
      const spinner = document.createElement('div');
      spinner.style.cssText = 'width: 20px; height: 20px; border: 2px solid var(--primary); border-top: 2px solid transparent; border-radius: 50%; animation: spin 1s linear infinite;';
      const label = document.createElement('span');
      label.textContent = '加载中...';
      loadingElement.append(spinner, label);
      document.body.appendChild(loadingElement);
    }
    loadingElement.style.display = 'flex';
  }
}

/**
 * 隐藏加载状态
 * 隐藏页面中央的加载动画
 */
function hideLoading() {
  const loadingElement = document.getElementById('loading-indicator');
  if (loadingElement) {
    loadingElement.style.display = 'none';
  }
}

/**
 * 显示错误提示
 * 在页面中央显示错误信息和重试按钮
 * @param {string} message - 错误信息
 */
function showError(message) {
  if (document.querySelector('.main-content')) {
    // 隐藏加载状态
    hideLoading();
    
    // 检查是否已经存在错误元素
    let errorElement = document.getElementById('error-message');
    if (!errorElement) {
      errorElement = document.createElement('div');
      errorElement.id = 'error-message';
      errorElement.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: var(--card-bg);
        padding: 20px;
        border-radius: 10px;
        box-shadow: var(--shadow);
        z-index: 9999;
        text-align: center;
        max-width: 400px;
      `;
      document.body.appendChild(errorElement);
    }
    
    // 用 DOM API 拼，不拼 innerHTML：面板里存着 token，手打的字段一旦被当 HTML 解析就等于递出写权限
    const heading = document.createElement('h3');
    heading.style.cssText = 'color: #ef4444; margin-bottom: 10px;';
    heading.textContent = '错误';
    const para = document.createElement('p');
    para.style.cssText = 'margin-bottom: 20px;';
    para.textContent = message;
    const retryBtn = document.createElement('button');
    retryBtn.id = 'retry-button';
    retryBtn.type = 'button';
    retryBtn.style.cssText = 'background: var(--primary); color: white; border: none; padding: 8px 16px; border-radius: 5px; cursor: pointer; font-weight: 500;';
    retryBtn.textContent = '重试';
    errorElement.replaceChildren(heading, para, retryBtn);
    errorElement.style.display = 'block';
    
    // 添加重试按钮事件
    document.getElementById('retry-button').addEventListener('click', () => {
      errorElement.style.display = 'none';
      // 触发重新加载数据
      window.dispatchEvent(new CustomEvent('retryFetchData'));
    });
  }
}

/**
 * 初始化网络状态监听
 */
function initNetworkListeners() {
  // 监听网络状态变化
  window.addEventListener('online', () => {
    const errorElement = document.getElementById('error-message');
    if (errorElement && errorElement.style.display === 'block') {
      errorElement.style.display = 'none';
      // 触发重新加载数据
      window.dispatchEvent(new CustomEvent('retryFetchData'));
    }
  });

  window.addEventListener('offline', () => {
    showError('网络连接已断开，请检查网络设置');
  });
}

export { showLoading, hideLoading, showError, initNetworkListeners };