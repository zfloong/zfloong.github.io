/**
 * 渲染模块
 * 处理DOM渲染功能
 *
 * 全部用 DOM API 构建，不用 innerHTML 拼数据：
 * 编辑模式下卡片名/网址是手打进去的，拼 HTML 会把 < 之类当标签解析（页面会坏，
 * 以后面板里存了 token 更是直接泄露）
 */

/** 只放行 http(s) 与站内相对路径，其它协议（javascript: 等）不落地成可点链接 */
function safeHref(url) {
  const value = (url || '').trim();
  if (!value) return '#';
  if (/^https?:\/\//i.test(value)) return value;
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? '#' : value;
}

/**
 * 生成一张卡片
 * @param {Object} item - 卡片数据
 * @param {Object} ref - 定位信息 {cat, sec, idx}，拖拽排序靠它回写数据
 */
function buildCard(item, ref) {
  const wrap = document.createElement('div');
  wrap.className = 'card-wrap';
  wrap.dataset.cat = ref.cat;
  wrap.dataset.idx = String(ref.idx);
  if (ref.sec != null) wrap.dataset.sec = String(ref.sec);

  const card = document.createElement('a');
  card.className = 'card';
  card.href = safeHref(item.url);
  card.target = '_blank';
  card.rel = 'noopener noreferrer';

  if (item.icon) {
    const img = document.createElement('img');
    img.src = item.icon;
    img.alt = item.title || '';
    img.addEventListener('error', () => { img.style.display = 'none'; });
    card.appendChild(img);
  } else if (item.iconSymbol) {
    const icon = document.createElement('i');
    icon.className = item.iconSymbol;
    icon.style.cssText = `font-size: 36px; color: ${item.iconColor || 'inherit'}; background: ${item.iconBg || 'transparent'}; border-radius: 8px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;`;
    card.appendChild(icon);
  }

  const info = document.createElement('div');
  info.className = 'card-info';
  const title = document.createElement('h3');
  title.textContent = item.title || '';
  info.appendChild(title);
  card.appendChild(info);

  wrap.appendChild(card);
  return wrap;
}

/**
 * 生成一组卡片的网格
 * @param {Array} items - 卡片数组
 * @param {string} catId - 所属分类 id
 * @param {number|null} secIndex - 分组序号，扁平分类为 null
 */
function buildGrid(items, catId, secIndex) {
  const grid = document.createElement('div');
  grid.className = 'grid';
  grid.dataset.cat = catId;
  grid.dataset.sec = secIndex == null ? 'flat' : String(secIndex);
  (items || []).forEach((item, idx) => {
    grid.appendChild(buildCard(item, { cat: catId, sec: secIndex, idx }));
  });
  return grid;
}

/**
 * 渲染搜索区
 * 创建搜索引擎按钮、快捷链接和搜索表单
 * @param {Object} searchData - 搜索相关配置数据
 */
function renderSearch(searchData) {
  const searchContainer = document.getElementById('search-container');
  if (!searchContainer) return;

  const fragment = document.createDocumentFragment();

  // A. 创建搜索引擎按钮容器
  const searchEnginesDiv = document.createElement('div');
  searchEnginesDiv.className = 'search-engines';

  searchData.engines.forEach((engine, index) => {
    const engineBtn = document.createElement('button');
    engineBtn.className = `engine-btn ${index === 0 ? 'active' : ''}`;
    engineBtn.setAttribute('data-url', engine.url);
    engineBtn.setAttribute('data-name', engine.param);
    // param 会重复（Google/Bing 都是 q），偏好只能按引擎名存
    engineBtn.setAttribute('data-engine', engine.name);
    engineBtn.textContent = engine.name;
    searchEnginesDiv.appendChild(engineBtn);
  });

  const divider = document.createElement('div');
  divider.className = 'divider';
  searchEnginesDiv.appendChild(divider);

  searchData.quickLinks.forEach(link => {
    const linkElement = document.createElement('a');
    linkElement.href = safeHref(link.url);
    linkElement.className = 'mini-icon';
    linkElement.target = '_blank';
    linkElement.rel = 'noopener noreferrer';
    linkElement.title = link.title;

    const imgElement = document.createElement('img');
    imgElement.alt = link.title;
    imgElement.src = link.icon;

    linkElement.appendChild(imgElement);
    searchEnginesDiv.appendChild(linkElement);
  });

  fragment.appendChild(searchEnginesDiv);

  // B. 创建搜索表单
  const searchForm = document.createElement('form');
  searchForm.id = 'searchForm';
  searchForm.action = searchData.engines[0].url.split('?')[0];
  searchForm.method = 'get';
  searchForm.target = '_blank';

  const searchBox = document.createElement('div');
  searchBox.className = 'search-box';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.name = searchData.engines[0].param;
  searchInput.className = 'search-input';
  searchInput.placeholder = 'Search...';
  searchInput.autocomplete = 'off';

  const searchBtn = document.createElement('button');
  searchBtn.type = 'submit';
  searchBtn.className = 'search-btn';
  const searchIcon = document.createElement('i');
  searchIcon.className = 'ri-search-2-line';
  searchBtn.appendChild(searchIcon);

  searchBox.appendChild(searchInput);
  searchBox.appendChild(searchBtn);
  searchForm.appendChild(searchBox);
  fragment.appendChild(searchForm);

  searchContainer.replaceChildren(fragment);
}

/**
 * 生成一个分类页签
 */
function buildTab(cat, index) {
  const tabBtn = document.createElement('button');
  tabBtn.className = `tab-btn ${index === 0 ? 'active' : ''}`;
  tabBtn.setAttribute('data-target', cat.id);
  tabBtn.dataset.idx = String(index);
  if (cat.icon) {
    const icon = document.createElement('i');
    icon.className = cat.icon;
    tabBtn.appendChild(icon);
    tabBtn.appendChild(document.createTextNode(' '));
  }
  tabBtn.appendChild(document.createTextNode(cat.navTitle || cat.id));
  return tabBtn;
}

/**
 * 生成一个分类的内容区
 */
function buildCategorySection(cat, index) {
  const section = document.createElement('div');
  section.id = cat.id;
  section.className = `category-section ${index === 0 ? 'active' : ''}`;

  if (Array.isArray(cat.sections)) {
    cat.sections.forEach((sectionData, si) => {
      const sectionTitle = document.createElement('div');
      sectionTitle.className = 'section-group-title';
      // 折叠状态存 localStorage，必须用稳定标识；用文案当 key 的话改个名状态就丢
      sectionTitle.dataset.key = `${cat.id}-${si}`;
      sectionTitle.textContent = sectionData.name;
      section.appendChild(sectionTitle);
      section.appendChild(buildGrid(sectionData.items, cat.id, si));
    });
  } else {
    const sectionHeader = document.createElement('div');
    sectionHeader.className = 'section-header';
    if (cat.icon) {
      const icon = document.createElement('i');
      icon.className = cat.icon;
      icon.style.fontSize = '1.8rem';
      if (cat.titleColor) icon.style.color = cat.titleColor;
      sectionHeader.appendChild(icon);
    }
    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'section-title';
    sectionTitle.textContent = cat.sectionTitle || cat.navTitle || '';
    sectionHeader.appendChild(sectionTitle);
    section.appendChild(sectionHeader);
    section.appendChild(buildGrid(cat.items, cat.id, null));
  }

  return section;
}

/**
 * 渲染导航栏和主内容区
 * @param {Array} categories - 分类数据数组
 */
function renderNavAndContent(categories) {
  const navTabsContainer = document.getElementById('navTabs');
  const mainContentContainer = document.getElementById('main-content-area');

  if (!navTabsContainer || !mainContentContainer) return;

  const navFragment = document.createDocumentFragment();
  const contentFragment = document.createDocumentFragment();

  categories.forEach((cat, index) => {
    navFragment.appendChild(buildTab(cat, index));
    contentFragment.appendChild(buildCategorySection(cat, index));
  });

  navTabsContainer.replaceChildren(navFragment);
  mainContentContainer.replaceChildren(contentFragment);
}

export { renderSearch, renderNavAndContent };
