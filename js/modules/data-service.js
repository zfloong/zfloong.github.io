/**
 * 数据服务模块
 * 处理数据获取
 */

/**
 * 获取数据的函数
 * 从本地data.json文件中获取网站配置数据
 * @async
 * @returns {Promise<Object>} 网站配置数据
 */
async function fetchData() {
  try {
    // no-cache（不是 no-store）：同样保证推送后刷新拿到新文件 —— 浏览器会带 ETag 去校验，
    // 文件没变就吃 304（省掉整包 25KB），变了才拿新的。
    // no-store 连校验都不做，每次刷新都全量重下，线上这份 data.json 白白多传一遍。
    const response = await fetch('./data.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('网络响应异常');
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('加载数据失败:', error);
    throw error;
  }
}

export { fetchData };
