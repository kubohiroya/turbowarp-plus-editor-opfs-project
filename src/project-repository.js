import git from 'isomorphic-git';
import { createGitFs } from './opfs-git-fs.js';

export const PROJECTS_DIRECTORY = 'turbowarp-plus-projects';
export const PROJECT_FILE = 'project.json';

// 空の Scratch 作品（ステージのみ）。SB3 の project.json と同じ形。
export function emptyProjectJson(title) {
  return JSON.stringify({
    targets: [{ isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {}, costumes: [], sounds: [], volume: 100, layerOrder: 0, tempo: 60, videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null }],
    monitors: [],
    extensions: [],
    meta: { semver: '3.0.0', vm: '0.2.0', agent: '', title },
  }, null, 2) + '\n';
}

// OPFS の root から作品ディレクトリを取り出す。
export async function openProjectDirectory(root, projectId, { create = false } = {}) {
  const base = await root.getDirectoryHandle(PROJECTS_DIRECTORY, { create });
  return base.getDirectoryHandle(projectId, { create });
}

async function hasGitDirectory(dir) {
  try {
    await dir.getDirectoryHandle('.git');
    return true;
  } catch {
    return false;
  }
}

// 1作品1リポジトリ: OPFS 上の作品フォルダを新規作成し、初期コミットを作る。
export async function createProjectRepository(root, { projectId, title, author }) {
  if (!/^[A-Za-z0-9_-]+$/.test(projectId)) throw new Error(`invalid projectId: ${projectId}`);
  const dir = await openProjectDirectory(root, projectId, { create: true });
  if (await hasGitDirectory(dir)) {
    const error = new Error(`project repository already exists: ${projectId}`);
    error.code = 'EEXIST';
    throw error;
  }
  const fs = createGitFs(dir);
  await git.init({ fs, dir: '/', defaultBranch: 'main' });
  const handle = await dir.getFileHandle(PROJECT_FILE, { create: true });
  const writable = await handle.createWritable();
  await writable.write(new TextEncoder().encode(emptyProjectJson(title)));
  await writable.close();
  await git.add({ fs, dir: '/', filepath: PROJECT_FILE });
  const commit = await git.commit({
    fs,
    dir: '/',
    message: `Create project ${title}`,
    author: { name: author.name, email: author.email },
  });
  return { projectId, commit, fs, dir: '/' };
}
