/* ============================================================
   Taleb Universe - Global Logic Engine vClean
   Current State: Navigation Only（每日语录数据见 wild.js 的 DAILY_QUOTES）
   ============================================================ */

// 1. 核心配置：全站导航菜单
const navLinks = [
    { name: '狂野生长', path: 'diet.html' },
    { name: '待定 · 01', path: 'index.html' },

];

// ============================================================
// 2. 注入引擎 (Injection Engine)
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    renderGlobalHeader();
    // Timeline 交互已移除
});

function renderGlobalHeader() {
    // 创建容器
    const header = document.createElement('div');
    header.id = 'global-header';
    
    // 生成导航栏 HTML (仅保留此部分)
    let navHTML = `<div class="nav-bar">`;
    const currentPath = window.location.pathname;

    navLinks.forEach(link => {
        let isActive = false;
        // 简单的路径匹配逻辑
        if (link.path === 'index.html' && (currentPath.endsWith('/') || currentPath.endsWith('index.html'))) {
            isActive = true;
        } else if (link.path !== 'index.html' && currentPath.includes(link.path)) {
            isActive = true;
        }

        navHTML += `<a href="${link.path}" class="nav-link ${isActive ? 'active' : ''}">${link.name}</a>`;
    });
    navHTML += `</div>`;

    // 插入页面顶部
    header.innerHTML = navHTML;
    document.body.prepend(header);
}
