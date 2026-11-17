import { unpackSb3 } from '@kubohiroya/sb3-toolchain/browser';
import { createGitFs } from './opfs-git-fs.js';
import { acquireProjectLock, LOCK_FILE } from './project-lock.js';
import { assertProjectId, commitChanges, GITIGNORE_FILE, openProjectDirectory } from './project-repository.js';

// 作業ツリーのうち、SB3 の入れ替えで消さないもの。
const KEEP_ON_IMPORT = new Set(['.git', LOCK_FILE, GITIGNORE_FILE]);
// SB3 の内容ではない、リポジトリ自身のファイル（書き出しに含めない）。
const REPOSITORY_METADATA = new Set(['.git', LOCK_FILE, GITIGNORE_FILE]);

async function removeWorkingTree(dir) {
  for await (const [name] of dir.entries()) {
    if (KEEP_ON_IMPORT.has(name)) continue;
    await dir.removeEntry(name, { recursive: true });
  }
}

async function readWorkingTree(dir, prefix = '', out = new Map()) {
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (prefix === '' && REPOSITORY_METADATA.has(name)) continue;
    if (handle.kind === 'directory') {
      await readWorkingTree(handle, path, out);
    } else {
      out.set(path, new Uint8Array(await (await handle.getFile()).arrayBuffer()));
    }
  }
  return out;
}

// SB3 を作品フォルダ（形式 v1）として OPFS の作業ツリーに入れ、変更があればコミットする。
// 作品はロックを取ってから書く。別の owner が有効なロックを持つ間は ProjectLockedError。
export async function importSb3Archive(root, { projectId, bytes, author, owner, now, staleMs }) {
  assertProjectId(projectId);
  const dir = await openProjectDirectory(root, projectId);
  const fs = createGitFs(dir);
  const lock = await acquireProjectLock(dir, { owner, now, staleMs });
  try {
    const { files, warnings } = unpackSb3(bytes);
    await removeWorkingTree(dir);
    const adapter = createGitFs(dir).promises;
    for (const [path, contents] of files) {
      await adapter.writeFile(`/${path}`, contents);
    }
    const commit = await commitChanges(fs, '/', 'Import SB3', author);
    return { commit, changed: commit !== null, warnings, files: [...files.keys()].sort() };
  } finally {
    await lock.release();
  }
}

// 作業ツリーから作品の内容を集め、呼び出し側が渡す buildArchive で SB3 のバイト列にする。
// SB3 への変換（source → project.json）は編集側の処理に任せる。ここではファイルの集めと受け渡しだけを行う。
export async function exportSb3Archive(root, { projectId, buildArchive }) {
  assertProjectId(projectId);
  if (typeof buildArchive !== 'function') throw new Error('buildArchive is required');
  const dir = await openProjectDirectory(root, projectId);
  const files = await readWorkingTree(dir);
  return buildArchive(files);
}
