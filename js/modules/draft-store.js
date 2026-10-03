/**
 * 本地草稿存储
 *
 * 编辑模式的改动先存在浏览器里（localStorage），刷新不丢；「复制 data.json」
 * 按仓库约定序列化后交给用户自己提交，「推送到 GitHub」则由 github-push 直接提交。
 *
 * 草稿有**三种状态**，顶部横幅只在第一种时出现：
 *   draft  有改动、还没推 —— 提示"本机有一份未提交的草稿"
 *   pushed 已经推到 GitHub —— 不提示，等 GitHub Pages 重建
 *          （那几分钟里内容还没生效，此时说"未提交"就是骗人）
 *   local  推送失败后用户选了"只存本机" —— 不提示，改动他自己管
 * 状态就是记录里的几个字段，loadDraft 原样带出去，谁读谁判断。
 */

const DRAFT_KEY = 'flyloong_edit_draft';

/** @returns {{savedAt:number, data:Object, baseSha:?string, pushedAt:?number, pushedCommit:?string, localOnly:boolean}|null} */
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
 * 内容变了就等于回到「未推送」：之前推没推过、是不是只存本机，都跟着作废。
 * @param {Object} data 改动后的完整数据
 * @param {string|null} baseSha 这份草稿基于的线上 data.json 版本，推送前用来发现线上被改过
 */
function saveDraft(data, baseSha = null) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      savedAt: Date.now(),
      data,
      baseSha: baseSha || null,
      pushedAt: null,
      pushedCommit: null,
      localOnly: false,
    }));
    return true;
  } catch (error) {
    console.error('保存本地草稿失败:', error);
    return false;
  }
}

/** 只改状态字段，不动内容（推送结果、本机保存都走这里） */
function patchDraft(patch) {
  const draft = loadDraft();
  if (!draft) return false;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, ...patch }));
    return true;
  } catch (error) {
    console.error('更新草稿状态失败:', error);
    return false;
  }
}

/** 推送成功：打上已推送标记，横幅从此不再说"未提交" */
function markPushed(commit) {
  return patchDraft({ pushedAt: Date.now(), pushedCommit: commit || null, localOnly: false });
}

/** 推送失败后用户选"只存本机"：改动继续生效在这台设备上，但不再催他推送 */
function markLocalOnly() {
  return patchDraft({ localOnly: true, pushedAt: null, pushedCommit: null });
}

/** @returns {'none'|'draft'|'pushed'|'local'} */
function draftState(draft) {
  if (!draft) return 'none';
  if (draft.localOnly) return 'local';
  if (draft.pushedAt) return 'pushed';
  return 'draft';
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

export { loadDraft, saveDraft, patchDraft, markPushed, markLocalOnly, draftState, clearDraft, toRepoJson, copyText };
