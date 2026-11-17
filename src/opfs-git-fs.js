// isomorphic-git 用の fs アダプター。OPFS の FileSystemDirectoryHandle（作品フォルダの根）の上で動く。
// 対応するのは通常のファイルとディレクトリだけで、シンボリックリンクは扱わない。

function notFound(path) {
  const error = new Error(`ENOENT: no such file or directory, '${path}'`);
  error.code = 'ENOENT';
  return error;
}

function splitPath(path) {
  return String(path).split('/').filter((part) => part !== '' && part !== '.');
}

async function walkDirectory(root, parts, create) {
  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

async function locate(root, path) {
  const parts = splitPath(path);
  if (parts.length === 0) return { kind: 'directory', handle: root, name: '' };
  const name = parts.pop();
  let parent;
  try {
    parent = await walkDirectory(root, parts, false);
  } catch {
    throw notFound(path);
  }
  try {
    return { kind: 'file', handle: await parent.getFileHandle(name), parent, name };
  } catch {
    // ファイルでなければ下でディレクトリとして探す
  }
  try {
    return { kind: 'directory', handle: await parent.getDirectoryHandle(name), parent, name };
  } catch {
    throw notFound(path);
  }
}

export function createGitFs(root) {
  const stat = async (path) => {
    const found = await locate(root, path);
    if (found.kind === 'directory') {
      return { type: 'dir', mode: 0o40755, size: 0, ino: 0, mtimeMs: 0, ctimeMs: 0, isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false };
    }
    const file = await found.handle.getFile();
    return { type: 'file', mode: 0o100644, size: file.size, ino: 0, mtimeMs: file.lastModified ?? 0, ctimeMs: file.lastModified ?? 0, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
  };

  const promises = {
    stat,
    lstat: stat,
    async readFile(path, options) {
      const found = await locate(root, path);
      if (found.kind !== 'file') throw notFound(path);
      const bytes = new Uint8Array(await (await found.handle.getFile()).arrayBuffer());
      const encoding = typeof options === 'string' ? options : options?.encoding;
      return encoding === 'utf8' ? new TextDecoder().decode(bytes) : bytes;
    },
    async writeFile(path, data) {
      const parts = splitPath(path);
      const name = parts.pop();
      const parent = await walkDirectory(root, parts, true);
      const handle = await parent.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      await writable.write(bytes);
      await writable.close();
    },
    async unlink(path) {
      const found = await locate(root, path);
      if (found.kind !== 'file') throw notFound(path);
      await found.parent.removeEntry(found.name);
    },
    async readdir(path) {
      const found = await locate(root, path);
      if (found.kind !== 'directory') throw notFound(path);
      const names = [];
      for await (const [name] of found.handle.entries()) names.push(name);
      return names;
    },
    async mkdir(path) {
      await walkDirectory(root, splitPath(path), true);
    },
    async rmdir(path) {
      const found = await locate(root, path);
      if (found.kind !== 'directory') throw notFound(path);
      await found.parent.removeEntry(found.name, { recursive: true });
    },
    async readlink() {
      const error = new Error('symbolic links are not supported in OPFS project folders');
      error.code = 'ENOSYS';
      throw error;
    },
    async symlink() {
      const error = new Error('symbolic links are not supported in OPFS project folders');
      error.code = 'ENOSYS';
      throw error;
    },
  };
  return { promises };
}
