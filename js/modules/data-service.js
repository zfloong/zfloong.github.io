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
    // no-store：推送后刷新页面必须拿到新文件，CDN 缓存里的旧 data.json 会让改动看起来没生效
    const response = await fetch('./data.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('网络响应异常');
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('加载数据失败:', error);
    throw error;
  }
}

export { fetchData };
