// isomorphic-git 用の fs アダプター。OPFS の FileSystemDirectoryHandle（作品フォルダの根）の上で動く。
// 対応するのは通常のファイルとディレクトリだけで、シンボリックリンクは扱わない。

import type { PromiseFsClient } from 'isomorphic-git';
import { codedError, writeBytes } from './opfs-types.ts';
import type { CodedError, DirectoryHandle, FileHandle } from './opfs-types.ts';

type Located =
  | { kind: 'directory'; handle: DirectoryHandle; parent?: undefined; name: '' }
  | { kind: 'directory'; handle: DirectoryHandle; parent: DirectoryHandle; name: string }
  | { kind: 'file'; handle: FileHandle; parent: DirectoryHandle; name: string };

export interface GitFsStat {
  type: 'file' | 'dir';
  mode: number;
  size: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export type ReadFileOptions = 'utf8' | { encoding?: string } | undefined;

export interface GitFsPromises {
  stat(path: string): Promise<GitFsStat>;
  lstat(path: string): Promise<GitFsStat>;
  readFile(path: string, options: 'utf8' | { encoding: 'utf8' }): Promise<string>;
  readFile(path: string, options?: ReadFileOptions): Promise<Uint8Array | string>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  unlink(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string): Promise<void>;
  rmdir(path: string): Promise<void>;
  readlink(): Promise<never>;
  symlink(): Promise<never>;
}

export interface GitFs extends PromiseFsClient {
  promises: GitFsPromises;
}

function notFound(path: string): CodedError {
  return codedError(`ENOENT: no such file or directory, '${path}'`, 'ENOENT');
}

function splitPath(path: string): string[] {
  return String(path).split('/').filter((part) => part !== '' && part !== '.');
}

async function walkDirectory(root: DirectoryHandle, parts: readonly string[], create: boolean): Promise<DirectoryHandle> {
  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

async function locate(root: DirectoryHandle, path: string): Promise<Located> {
  const parts = splitPath(path);
  const name = parts.pop();
  if (name === undefined) return { kind: 'directory', handle: root, name: '' };
  let parent: DirectoryHandle;
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

function symlinkUnsupported(): never {
  throw codedError('symbolic links are not supported in OPFS project folders', 'ENOSYS');
}

export function createGitFs(root: DirectoryHandle): GitFs {
  const stat = async (path: string): Promise<GitFsStat> => {
    const found = await locate(root, path);
    if (found.kind === 'directory') {
      return { type: 'dir', mode: 0o40755, size: 0, ino: 0, mtimeMs: 0, ctimeMs: 0, isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false };
    }
    const file = await found.handle.getFile();
    const lastModified = 'lastModified' in file && typeof file.lastModified === 'number' ? file.lastModified : 0;
    return { type: 'file', mode: 0o100644, size: file.size, ino: 0, mtimeMs: lastModified, ctimeMs: lastModified, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
  };

  async function readFile(path: string, options: 'utf8' | { encoding: 'utf8' }): Promise<string>;
  async function readFile(path: string, options?: ReadFileOptions): Promise<Uint8Array | string>;
  async function readFile(path: string, options?: ReadFileOptions): Promise<Uint8Array | string> {
    const found = await locate(root, path);
    if (found.kind !== 'file') throw notFound(path);
    const bytes = new Uint8Array(await (await found.handle.getFile()).arrayBuffer());
    const encoding = typeof options === 'string' ? options : options?.encoding;
    return encoding === 'utf8' ? new TextDecoder().decode(bytes) : bytes;
  }

  const promises: GitFsPromises = {
    stat,
    lstat: stat,
    readFile,
    async writeFile(path, data) {
      const parts = splitPath(path);
      const name = parts.pop();
      if (name === undefined) throw codedError(`EISDIR: illegal operation on a directory, '${path}'`, 'EISDIR');
      const parent = await walkDirectory(root, parts, true);
      const handle = await parent.getFileHandle(name, { create: true });
      await writeBytes(handle, typeof data === 'string' ? new TextEncoder().encode(data) : data);
    },
    async unlink(path) {
      const found = await locate(root, path);
      if (found.kind !== 'file') throw notFound(path);
      await found.parent.removeEntry(found.name);
    },
    async readdir(path) {
      const found = await locate(root, path);
      if (found.kind !== 'directory') throw notFound(path);
      const names: string[] = [];
      for await (const [name] of found.handle.entries()) names.push(name);
      return names;
    },
    async mkdir(path) {
      await walkDirectory(root, splitPath(path), true);
    },
    async rmdir(path) {
      const found = await locate(root, path);
      if (found.kind !== 'directory' || found.parent === undefined) throw notFound(path);
      await found.parent.removeEntry(found.name, { recursive: true });
    },
    async readlink() {
      return symlinkUnsupported();
    },
    async symlink() {
      return symlinkUnsupported();
    },
  };
  return { promises };
}
