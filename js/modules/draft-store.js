/**
 * 本地草稿存储
 *
 * 编辑模式的改动先存在浏览器里（localStorage），刷新不丢；「复制 data.json」
 * 按仓库约定序列化后交给用户自己提交。以后接上 GitHub Contents API 直推时，
 * 这里的 JSON 就是提交内容。
 */

const DRAFT_KEY = 'flyloong_edit_draft';

/** @returns {{savedAt:number, data:Object}|null} */
function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.data) return null;
    return parsed;
  } catch (error) {
    console.error('读取本地草稿失败:', error);
    return null;
  }
}

/**
 * @param {Object} data 改动后的完整数据
 * @param {string|null} baseSha 这份草稿基于的线上 data.json 版本，推送前用来发现线上被改过
 */
function saveDraft(data, baseSha = null) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), data, baseSha: baseSha || null }));
    return true;
  } catch (error) {
    console.error('保存本地草稿失败:', error);
    return false;
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch (error) {
    console.error('清除本地草稿失败:', error);
  }
}

/** 按 data.json 既有格式序列化：2 空格缩进 + CRLF + 结尾换行（无 BOM） */
function toRepoJson(data) {
  return JSON.stringify(data, null, 2).replace(/\r?\n/g, '\r\n') + '\r\n';
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('复制到剪贴板失败:', error);
    return false;
  }
}

export { loadDraft, saveDraft, clearDraft, toRepoJson, copyText };
