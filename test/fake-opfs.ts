// テスト用の OPFS 風ディレクトリ。FileSystemDirectoryHandle と同じメソッドだけを持つ。
import type { DirectoryHandle, FileHandle, WritableFileStream } from '../src/opfs-types.ts';

interface FileEntry {
  kind: 'file';
  bytes: Uint8Array;
}

interface DirectoryEntry {
  kind: 'directory';
  handle: FakeDirectory;
}

type Entry = FileEntry | DirectoryEntry;

export class FakeFile implements FileHandle {
  readonly kind = 'file';
  readonly entry: FileEntry;
  constructor(entry: FileEntry) { this.entry = entry; }
  async getFile(): Promise<Blob> { return new Blob([new Uint8Array(this.entry.bytes)]); }
  async createWritable(): Promise<WritableFileStream> {
    const entry = this.entry;
    const chunks: Uint8Array[] = [];
    return {
      async write(data) { chunks.push(new Uint8Array(data)); },
      async close() {
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
        entry.bytes = bytes;
      },
    };
  }
}

export class FakeDirectory implements DirectoryHandle {
  readonly kind = 'directory';
  readonly name: string;
  readonly children = new Map<string, Entry>();
  constructor(name = '') { this.name = name; }
  async getDirectoryHandle(name: string, { create = false } = {}): Promise<FakeDirectory> {
    const existing = this.children.get(name);
    if (existing && existing.kind === 'directory') return existing.handle;
    if (existing) throw new DOMException(`${name} is a file`, 'TypeMismatchError');
    if (!create) throw new DOMException(`${name} not found`, 'NotFoundError');
    const dir = new FakeDirectory(name);
    this.children.set(name, { kind: 'directory', handle: dir });
    return dir;
  }
  async getFileHandle(name: string, { create = false } = {}): Promise<FakeFile> {
    const existing = this.children.get(name);
    if (existing && existing.kind === 'file') return new FakeFile(existing);
    if (existing) throw new DOMException(`${name} is a directory`, 'TypeMismatchError');
    if (!create) throw new DOMException(`${name} not found`, 'NotFoundError');
    const entry: FileEntry = { kind: 'file', bytes: new Uint8Array(0) };
    this.children.set(name, entry);
    return new FakeFile(entry);
  }
  async removeEntry(name: string, { recursive = false } = {}): Promise<void> {
    const entry = this.children.get(name);
    if (!entry) throw new DOMException(`${name} not found`, 'NotFoundError');
    if (entry.kind === 'directory' && entry.handle.children.size > 0 && !recursive) {
      throw new DOMException(`${name} not empty`, 'InvalidModificationError');
    }
    this.children.delete(name);
  }
  async *entries(): AsyncGenerator<[string, FakeDirectory | FakeFile]> {
    for (const [name, entry] of this.children) {
      yield [name, entry.kind === 'directory' ? entry.handle : new FakeFile(entry)];
    }
  }
}

// openProjectDirectory などが返すハンドルを、中身を覗けるフェイクとして扱う。
export function asFake(dir: DirectoryHandle): FakeDirectory {
  if (!(dir instanceof FakeDirectory)) throw new Error('expected a FakeDirectory');
  return dir;
}
