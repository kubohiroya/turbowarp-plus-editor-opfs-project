import { unpackSb3 } from '@kubohiroya/sb3-toolchain/browser';
import type { UnpackWarning } from '@kubohiroya/sb3-toolchain/browser';
import { createGitFs } from './opfs-git-fs.ts';
import { acquireProjectLock, LOCK_FILE } from './project-lock.ts';
import { assertProjectId, commitChanges, GITIGNORE_FILE, openProjectDirectory } from './project-repository.ts';
import type { Author } from './project-repository.ts';
import { isDirectoryHandle, isFileHandle } from './opfs-types.ts';
import { createHistoryBundle, HISTORY_BUNDLE_PATH } from './project-history.ts';
import type { HistoryBundleRef } from './project-history.ts';
import type { DirectoryHandle } from './opfs-types.ts';

// 作業ツリーのうち、SB3 の入れ替えで消さないもの。
const KEEP_ON_IMPORT: ReadonlySet<string> = new Set(['.git', LOCK_FILE, GITIGNORE_FILE]);
// SB3 の内容ではない、リポジトリ自身のファイル（書き出しに含めない）。
const REPOSITORY_METADATA: ReadonlySet<string> = new Set(['.git', LOCK_FILE, GITIGNORE_FILE]);

export interface ImportSb3ArchiveOptions {
  projectId: string;
  bytes: Uint8Array;
  author: Author;
  owner: string;
  now?: number | undefined;
  staleMs?: number | undefined;
}

export interface ImportSb3ArchiveResult {
  commit: string | null;
  changed: boolean;
  warnings: UnpackWarning[];
  files: string[];
}

/** 作業ツリーのファイル（パス → 中身）から SB3 のバイト列を作る関数。 */
export type BuildArchive<T = Uint8Array> = (files: Map<string, Uint8Array>) => T | Promise<T>;

export interface ExportSb3ArchiveOptions<T> {
  projectId: string;
  buildArchive: BuildArchive<T>;
}

async function removeWorkingTree(dir: DirectoryHandle): Promise<void> {
  for await (const [name] of dir.entries()) {
    if (KEEP_ON_IMPORT.has(name)) continue;
    await dir.removeEntry(name, { recursive: true });
  }
}

async function readWorkingTree(dir: DirectoryHandle, prefix = '', out = new Map<string, Uint8Array>()): Promise<Map<string, Uint8Array>> {
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (prefix === '' && REPOSITORY_METADATA.has(name)) continue;
    if (isDirectoryHandle(handle)) {
      await readWorkingTree(handle, path, out);
    } else if (isFileHandle(handle)) {
      out.set(path, new Uint8Array(await (await handle.getFile()).arrayBuffer()));
    }
  }
  return out;
}

// SB3 を作品フォルダ（形式 v1）として OPFS の作業ツリーに入れ、変更があればコミットする。
// 作品はロックを取ってから書く。別の owner が有効なロックを持つ間は ProjectLockedError。
export async function importSb3Archive(
  root: DirectoryHandle,
  { projectId, bytes, author, owner, now, staleMs }: ImportSb3ArchiveOptions,
): Promise<ImportSb3ArchiveResult> {
  assertProjectId(projectId);
  const dir = await openProjectDirectory(root, projectId);
  const fs = createGitFs(dir);
  const lock = await acquireProjectLock(dir, { owner, now, staleMs });
  try {
    const { files, warnings } = unpackSb3(bytes);
    await removeWorkingTree(dir);
    for (const [path, contents] of files) {
      await fs.promises.writeFile(`/${path}`, contents);
    }
    const commit = await commitChanges(fs, '/', 'Import SB3', author);
    return { commit, changed: commit !== null, warnings, files: [...files.keys()].sort() };
  } finally {
    await lock.release();
  }
}

// 作業ツリーから作品の内容を集め、呼び出し側が渡す buildArchive で SB3 のバイト列にする。
// SB3 への変換（source → project.json）は編集側の処理に任せる。ここではファイルの集めと受け渡しだけを行う。
export async function exportSb3Archive<T>(root: DirectoryHandle, { projectId, buildArchive }: ExportSb3ArchiveOptions<T>): Promise<T> {
  assertProjectId(projectId);
  if (typeof buildArchive !== 'function') throw new Error('buildArchive is required');
  const dir = await openProjectDirectory(root, projectId);
  const files = await readWorkingTree(dir);
  return buildArchive(files);
}

export interface ExportSb3WithHistoryOptions<T> {
  projectId: string;
  buildArchive: BuildArchive<T>;
  author: Author;
  owner: string;
  // true なら、未コミットの変更を先にコミットしてから書き出す（作業ツリーは変わる）。
  includeUncommitted: boolean;
  now?: number | undefined;
  staleMs?: number | undefined;
}

export interface ExportSb3WithHistoryResult<T> {
  archive: T;
  commit: string | null;
  bundleRefs: HistoryBundleRef[];
  commitCount: number;
  bundleBytes: number;
}

// 履歴付きの書き出し。作品の内容に加えて tw-plus/history.bundle を入れる。
// includeUncommitted のときは、ロックを取ってから未コミットの変更を記録する。
export async function exportSb3WithHistory<T>(
  root: DirectoryHandle,
  { projectId, buildArchive, author, owner, includeUncommitted, now, staleMs }: ExportSb3WithHistoryOptions<T>,
): Promise<ExportSb3WithHistoryResult<T>> {
  assertProjectId(projectId);
  if (typeof buildArchive !== 'function') throw new Error('buildArchive is required');
  const dir = await openProjectDirectory(root, projectId);
  const fs = createGitFs(dir);
  let commit: string | null = null;
  if (includeUncommitted) {
    const lock = await acquireProjectLock(dir, { owner, now, staleMs });
    try {
      commit = await commitChanges(fs, '/', 'Save before export', author);
    } finally {
      await lock.release();
    }
  }
  const bundle = await createHistoryBundle(fs, '/');
  const files = await readWorkingTree(dir);
  files.set(HISTORY_BUNDLE_PATH, bundle.bytes);
  const archive = await buildArchive(files);
  return {
    archive,
    commit,
    bundleRefs: bundle.refs,
    commitCount: bundle.commitCount,
    bundleBytes: bundle.bytes.length,
  };
}
