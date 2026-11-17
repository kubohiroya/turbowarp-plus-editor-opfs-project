import git from 'isomorphic-git';
import type { FsClient } from 'isomorphic-git';
import { createGitFs } from './opfs-git-fs.ts';
import type { GitFs } from './opfs-git-fs.ts';
import { LOCK_FILE } from './project-lock.ts';
import { codedError, writeBytes } from './opfs-types.ts';
import type { DirectoryHandle } from './opfs-types.ts';

export const PROJECTS_DIRECTORY = 'turbowarp-plus-projects';
export const PROJECT_FILE = 'project.json';
export const GITIGNORE_FILE = '.gitignore';

export interface Author {
  name: string;
  email: string;
}

export interface CreateProjectRepositoryOptions {
  projectId: string;
  title: string;
  author: Author;
}

export interface CreatedProjectRepository {
  projectId: string;
  commit: string;
  fs: GitFs;
  dir: '/';
}

// 空の Scratch 作品（ステージのみ）。SB3 の project.json と同じ形。
export function emptyProjectJson(title: string): string {
  return JSON.stringify({
    targets: [{ isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {}, costumes: [], sounds: [], volume: 100, layerOrder: 0, tempo: 60, videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null }],
    monitors: [],
    extensions: [],
    meta: { semver: '3.0.0', vm: '0.2.0', agent: '', title },
  }, null, 2) + '\n';
}

// OPFS の root から作品ディレクトリを取り出す。
export async function openProjectDirectory(
  root: DirectoryHandle,
  projectId: string,
  { create = false }: { create?: boolean } = {},
): Promise<DirectoryHandle> {
  const base = await root.getDirectoryHandle(PROJECTS_DIRECTORY, { create });
  return base.getDirectoryHandle(projectId, { create });
}

export function assertProjectId(projectId: unknown): asserts projectId is string {
  if (typeof projectId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(projectId)) {
    throw new Error(`invalid projectId: ${String(projectId)}`);
  }
}

async function hasEntry(dir: DirectoryHandle, name: string, kind: 'file' | 'directory'): Promise<boolean> {
  try {
    if (kind === 'directory') await dir.getDirectoryHandle(name);
    else await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function writeText(dir: DirectoryHandle, name: string, text: string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  await writeBytes(handle, new TextEncoder().encode(text));
}

// 作業ツリーの変更（追加・変更・削除）を一度にステージしてコミットする。
// ロックファイルは対象外。変更がなければ何もせず null を返す。
export async function commitChanges(fs: FsClient, dir: string, message: string, author: Author): Promise<string | null> {
  const matrix = (await git.statusMatrix({ fs, dir })).filter(([file]) => file !== LOCK_FILE);
  const changed = matrix.filter(([, head, workdir, stage]) => !(head === workdir && workdir === stage));
  if (changed.length === 0) return null;
  for (const [file, head, workdir] of changed) {
    if (workdir === 0) {
      if (head === 1) await git.remove({ fs, dir, filepath: file });
    } else {
      await git.add({ fs, dir, filepath: file });
    }
  }
  return git.commit({ fs, dir, message, author });
}

// 1作品1リポジトリ: OPFS 上の作品フォルダを新規作成し、初期コミットを作る。
export async function createProjectRepository(
  root: DirectoryHandle,
  { projectId, title, author }: CreateProjectRepositoryOptions,
): Promise<CreatedProjectRepository> {
  assertProjectId(projectId);
  const dir = await openProjectDirectory(root, projectId, { create: true });
  if (await hasEntry(dir, '.git', 'directory')) {
    throw codedError(`project repository already exists: ${projectId}`, 'EEXIST');
  }
  const fs = createGitFs(dir);
  await git.init({ fs, dir: '/', defaultBranch: 'main' });
  await writeText(dir, GITIGNORE_FILE, `${LOCK_FILE}\n`);
  await writeText(dir, PROJECT_FILE, emptyProjectJson(title));
  await git.add({ fs, dir: '/', filepath: GITIGNORE_FILE });
  await git.add({ fs, dir: '/', filepath: PROJECT_FILE });
  const commit = await git.commit({
    fs,
    dir: '/',
    message: `Create project ${title}`,
    author: { name: author.name, email: author.email },
  });
  return { projectId, commit, fs, dir: '/' };
}
