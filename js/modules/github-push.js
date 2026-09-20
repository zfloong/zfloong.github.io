/**
 * 直推 GitHub（不需要任何后端）
 *
 * 静态页面能自己提交，靠的是 GitHub API 对浏览器开放 CORS：预检会放行
 * authorization 头（实测 OPTIONS /repos/.../contents/data.json → 204 +
 * Access-Control-Allow-Origin: *），所以带 token 的请求可以直接从浏览器发出。
 *
 * token 是用户在 github.com 生成的 fine-grained PAT，只勾这一个仓库 +
 * Contents: Read and write，存在浏览器 localStorage —— 相当于「输一次密码」，
 * 只是这个密码能随时在 GitHub 上撤销，且换台电脑要重新输一次。
 *
 * 一次推送 = 一个提交：data.json 和新抓的图标走 Git Data API 打成一棵 tree，
 * 全部成功才移动分支指针，不会出现「卡片指向一个还没上传的图标」的中间状态。
 */

const TOKEN_KEY = 'flyloong_gh_token';
const OWNER = 'zfloong';
const REPO = 'zfloong.github.io';
const BRANCH = 'main';
const API = 'https://api.github.com';
const REPO_PATH = `${OWNER}/${REPO}`;
const REPO_URL = `https://github.com/${REPO_PATH}`;
const TOKEN_NEW_URL = 'https://github.com/settings/personal-access-tokens/new';

/** 草稿是基于哪个线上版本做的，用来发现「线上被别人改过」 */
let baseSha = null;

class PushError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'PushError';
    this.kind = kind || 'unknown';
  }
}

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (error) { return ''; }
}

function setToken(value) {
  try { localStorage.setItem(TOKEN_KEY, value); return true; } catch (error) {
    console.error('保存 token 失败:', error);
    return false;
  }
}

function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch (error) { console.error('清除 token 失败:', error); }
}

function getBase() { return baseSha; }
function setBase(sha) { baseSha = sha || null; }

function httpError(status, payload) {
  const detail = payload && payload.message ? payload.message : '';
  if (status === 401) return new PushError('token 无效或已过期，重新生成一个再填', 'token');
  if (status === 403) {
    if (/rate limit/i.test(detail)) return new PushError('GitHub 限流了，过一会儿再试', 'rate');
    return new PushError('token 权限不够：需要这个仓库的 Contents: Read and write', 'forbidden');
  }
  if (status === 404) return new PushError('读不到这个仓库，确认 token 里勾选了 zfloong/zfloong.github.io', 'missing');
  if (status === 409 || status === 422) return new PushError('线上有新版本，先刷新页面确认后再推送', 'conflict');
  return new PushError(`GitHub 返回 ${status}${detail ? `：${detail}` : ''}`, 'unknown');
}

async function gh(path, options = {}) {
  const { method = 'GET', token = getToken(), body } = options;
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch (error) {
    throw new PushError('网络请求失败，检查一下网络连接', 'network');
  }

  const text = await res.text();
  let payload = null;
  if (text) { try { payload = JSON.parse(text); } catch (error) { payload = null; } }
  if (!res.ok) throw httpError(res.status, payload);
  return payload;
}

/** 验证 token 是否可用、是否够得着这个仓库 */
async function verifyToken(token) {
  if (!token) throw new PushError('先把 token 粘贴进来', 'token');
  const user = await gh('/user', { token });
  const repo = await gh(`/repos/${REPO_PATH}`, { token });
  return {
    login: user.login,
    repo: repo.full_name,
    branch: repo.default_branch || BRANCH,
    canWrite: !repo.permissions || repo.permissions.push !== false,
  };
}

/** 线上 data.json 的当前版本（公开仓库不带 token 也能读） */
async function readRemoteJson(token = getToken()) {
  const file = await gh(`/repos/${REPO_PATH}/contents/data.json?ref=${BRANCH}`, { token });
  return { sha: file.sha, size: file.size };
}

/** 列一个目录，返回 path → 文件信息（公开仓库不带 token 也能读） */
async function listDir(dir, token = getToken()) {
  const files = await gh(`/repos/${REPO_PATH}/contents/${dir}?ref=${BRANCH}`, { token });
  const map = new Map();
  if (Array.isArray(files)) files.forEach(f => map.set(f.path, f));
  return map;
}

/**
 * 把 data.json 与图标提交成一个 commit
 * @param {Object} options
 * @param {string} options.message 提交信息
 * @param {string} options.jsonText data.json 的完整文本
 * @param {Array<{path:string, base64:string}>} options.icons 本次要新增的图标
 * @param {string|null} options.expectedSha 基线版本，和线上不一致就中止
 */
async function commitAll(options) {
  const { message, jsonText, icons = [], expectedSha = null, token = getToken() } = options;
  if (!token) throw new PushError('还没连接 GitHub', 'token');

  const remote = await readRemoteJson(token);
  if (expectedSha && remote.sha !== expectedSha) {
    throw new PushError('线上 data.json 被改过了（不是从你看的版本开始的改动）', 'conflict');
  }

  const ref = await gh(`/repos/${REPO_PATH}/git/ref/heads/${BRANCH}`, { token });
  const head = await gh(`/repos/${REPO_PATH}/git/commits/${ref.object.sha}`, { token });

  const tree = [{ path: 'data.json', mode: '100644', type: 'blob', content: jsonText }];
  const uploaded = [];
  for (const icon of icons) {
    const blob = await gh(`/repos/${REPO_PATH}/git/blobs`, {
      method: 'POST',
      token,
      body: { content: icon.base64, encoding: 'base64' },
    });
    tree.push({ path: icon.path, mode: '100644', type: 'blob', sha: blob.sha });
    uploaded.push(icon.path);
  }

  const newTree = await gh(`/repos/${REPO_PATH}/git/trees`, {
    method: 'POST',
    token,
    body: { base_tree: head.tree.sha, tree },
  });
  const commit = await gh(`/repos/${REPO_PATH}/git/commits`, {
    method: 'POST',
    token,
    body: { message, tree: newTree.sha, parents: [ref.object.sha] },
  });
  await gh(`/repos/${REPO_PATH}/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    token,
    body: { sha: commit.sha, force: false },
  });

  const after = await readRemoteJson(token);
  baseSha = after.sha;
  return { commit: commit.sha, icons: uploaded, url: `${REPO_URL}/commit/${commit.sha}` };
}

export {
  PushError,
  getToken, setToken, clearToken,
  getBase, setBase,
  verifyToken, readRemoteJson, listDir, commitAll,
  REPO_PATH, REPO_URL, BRANCH, TOKEN_NEW_URL,
};
