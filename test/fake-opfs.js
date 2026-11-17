// テスト用の OPFS 風ディレクトリ。FileSystemDirectoryHandle と同じメソッドだけを持つ。
export class FakeFile {
  kind = 'file';
  constructor(entry) { this.entry = entry; }
  async getFile() { return new Blob([this.entry.bytes]); }
  async createWritable() {
    const entry = this.entry;
    let chunks = [];
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

export class FakeDirectory {
  kind = 'directory';
  constructor(name = '') { this.name = name; this.children = new Map(); }
  async getDirectoryHandle(name, { create = false } = {}) {
    const existing = this.children.get(name);
    if (existing && existing.kind === 'directory') return existing.handle;
    if (existing) throw new DOMException(`${name} is a file`, 'TypeMismatchError');
    if (!create) throw new DOMException(`${name} not found`, 'NotFoundError');
    const dir = new FakeDirectory(name);
    this.children.set(name, { kind: 'directory', handle: dir });
    return dir;
  }
  async getFileHandle(name, { create = false } = {}) {
    const existing = this.children.get(name);
    if (existing && existing.kind === 'file') return new FakeFile(existing);
    if (existing) throw new DOMException(`${name} is a directory`, 'TypeMismatchError');
    if (!create) throw new DOMException(`${name} not found`, 'NotFoundError');
    const entry = { kind: 'file', bytes: new Uint8Array(0) };
    this.children.set(name, entry);
    return new FakeFile(entry);
  }
  async removeEntry(name, { recursive = false } = {}) {
    const entry = this.children.get(name);
    if (!entry) throw new DOMException(`${name} not found`, 'NotFoundError');
    if (entry.kind === 'directory' && entry.handle.children.size > 0 && !recursive) {
      throw new DOMException(`${name} not empty`, 'InvalidModificationError');
    }
    this.children.delete(name);
  }
  async *entries() {
    for (const [name, entry] of this.children) {
      yield [name, entry.kind === 'directory' ? entry.handle : new FakeFile(entry)];
    }
  }
}
