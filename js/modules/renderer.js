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
  // 协议相对地址（//evil.com、/\evil.com）会被浏览器当成外站 https 链接，不能当相对路径放行
  if (/^\/[\/\\]/.test(value)) return '#';
  // 浏览器解析 scheme 时会剥掉中间的制表符/换行，java\tscript: 会被当成 javascript:；
  // 先去掉空白与控制字符再判一次，堵住这种伪协议
  const compact = value.replace(/[\s\u0000-\u001f\u007f]/g, '');
  return /^[a-z][a-z0-9+.-]*:/i.test(compact) ? '#' : value;
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

  // 空位：不渲染任何内容，只占一个格子。
  // 正常浏览模式下 visibility:hidden 完全隐形；编辑模式下显示虚线轮廓提示"这里是空位"。
  // 空位不能直接删除，只能被拖入的卡片填入（见 drag-sort.js / editor.js moveCard）。
  if (item && item.type === 'spacer') {
    wrap.classList.add('spacer');
    return wrap;
  }

  // 锁定卡片：用 grid-column / grid-row 钉在固定格子，非锁定卡片流式排列时会自动绕过它。
  // 这样无论其他卡片怎么拖动，锁定卡片都纹丝不动。
  if (item && item.locked) {
    wrap.classList.add('locked');
    if (item.pos != null) wrap.dataset.pos = String(item.pos);
  }

  const card = document.createElement('a');
  card.className = 'card';
  card.href = safeHref(item.url);
  card.target = '_blank';
  card.rel = 'noopener noreferrer';

  if (item.icon) {
    const img = document.createElement('img');
    img.src = item.icon;
    // 分类区除当前一个外都是 display:none，但浏览器照样会把里面的 <img> 全抓下来 ——
    // 130 张卡的图标会在冷启动时一次性发 129 个请求（实测 417KB），而首屏只看得到 20 张。
    // lazy 让隐藏分类的图标等到真正切过去再拉，启动请求数 149 → 40。别删。
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = item.title || '';
    img.addEventListener('error', () => {
      img.style.display = 'none';
      // 图片加载失败但卡片还有 iconSymbol（remixicon），回退到符号图标，
      // 避免被 autoIcon 误写过 icon 的卡片一直是空白。
      if (item.iconSymbol) {
        const fallback = document.createElement('i');
        fallback.className = item.iconSymbol;
        fallback.style.cssText = `font-size: 36px; color: ${item.iconColor || 'inherit'}; background: ${item.iconBg || 'transparent'}; border-radius: 8px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;`;
        card.insertBefore(fallback, img.nextSibling);
      }
    });
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

  // 锁定标记：编辑模式下显示锁图标，提示这张卡片位置固定、不能拖
  if (item && item.locked) {
    const lock = document.createElement('span');
    lock.className = 'lock-badge';
    lock.setAttribute('aria-hidden', 'true');
    lock.textContent = '';
    card.appendChild(lock);
  }

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

  // 非锁定卡片先渲染：它们走 grid 自动流式排列。
  // 锁定卡片后渲染：它们用 grid-column / grid-row 显式定位，不会参与流式排列，
  // 后渲染也不会影响非锁定卡片的自动布局。
  const locked = [];
  (items || []).forEach((item, idx) => {
    if (item && item.locked) {
      locked.push({ item, idx });
    } else {
      grid.appendChild(buildCard(item, { cat: catId, sec: secIndex, idx }));
    }
  });
  locked.forEach(({ item, idx }) => {
    grid.appendChild(buildCard(item, { cat: catId, sec: secIndex, idx }));
  });
  return grid;
}

/** 读取 grid 当前的列数（由 CSS repeat(auto-fill, minmax(...)) 决定） */
function gridColumnCount(grid) {
  const cs = getComputedStyle(grid).gridTemplateColumns;
  if (!cs || cs === 'none') return 6;
  return cs.split(/\s+/).filter(Boolean).length;
}

/**
 * 给所有锁定卡片应用 grid-column / grid-row，把它们钉在 pos 指定的格子上。
 * 必须在 grid 进入 DOM 之后调用（否则 getComputedStyle 拿不到真实列数）。
 * 非锁定卡片不处理，继续走自动流式排列，会自然绕过锁定卡片占的格子。
 */
function applyLockedLayout(root = document) {
  root.querySelectorAll('.grid').forEach(grid => {
    if (grid.offsetParent === null) return;   // 隐藏分类不测，切到它时再布局
    const cols = gridColumnCount(grid);
    if (cols < 1) return;
    grid.querySelectorAll('.card-wrap.locked').forEach(wrap => {
      const pos = Number(wrap.dataset.pos);
      if (!Number.isFinite(pos)) return;
      const col = (pos % cols) + 1;
      const row = Math.floor(pos / cols) + 1;
      wrap.style.gridColumn = String(col);
      wrap.style.gridRow = String(row);
    });
  });
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
      // 折叠状态存 localStorage，用 cat.id + 分组名当 key：分组重排/删除后索引会错位，
      // 名字是这一段里唯一稳定的东西（改名的代价只是这一组折叠状态丢失）
      sectionTitle.dataset.key = `${cat.id}-${sectionData.name}`;
      // 编辑模式靠它知道这是第几个分组（加卡片要写回 cat.sections[si]），别再解析 key
      sectionTitle.dataset.sec = String(si);
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

  // grid 进 DOM 后才能测到真实列数，下一帧给锁定卡片定位
  requestAnimationFrame(() => applyLockedLayout());
}

export { renderSearch, renderNavAndContent, applyLockedLayout, gridColumnCount };
