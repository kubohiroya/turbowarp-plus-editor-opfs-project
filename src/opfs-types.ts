// このライブラリが使う OPFS のハンドルの最小限の形。
// ブラウザーの FileSystemDirectoryHandle / FileSystemFileHandle はそのまま渡せる。
// テストではこの形だけを持つフェイクを使う。

export interface WritableFileStream {
  write(data: Uint8Array<ArrayBuffer>): Promise<void>;
  close(): Promise<void>;
}

export interface FileHandle {
  readonly kind: 'file';
  getFile(): Promise<Blob>;
  createWritable(): Promise<WritableFileStream>;
}

/** entries() が返すハンドル。kind を見て isDirectoryHandle / isFileHandle で絞り込む。 */
export interface EntryHandle {
  readonly kind: 'file' | 'directory';
}

export interface DirectoryHandle {
  readonly kind: 'directory';
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<[string, EntryHandle]>;
}

export function isDirectoryHandle(handle: EntryHandle): handle is DirectoryHandle {
  return handle.kind === 'directory';
}

export function isFileHandle(handle: EntryHandle): handle is FileHandle {
  return handle.kind === 'file';
}

/** Node の fs のように code を持つエラー。 */
export interface CodedError extends Error {
  code: string;
}

export function codedError(message: string, code: string): CodedError {
  return Object.assign(new Error(message), { code });
}

export async function writeBytes(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  const writable = await handle.createWritable();
  // OPFS の write は SharedArrayBuffer を受け付けないため、その場合だけ複製する。
  await writable.write(bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : new Uint8Array(bytes));
  await writable.close();
}
