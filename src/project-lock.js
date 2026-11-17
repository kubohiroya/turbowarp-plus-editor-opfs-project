// 作品ディレクトリ直下のロックファイル。同じ作品を複数のプロセスで書かないための記録。
// 別のタブ・プロセスが取得したまま、heartbeat が staleMs より古ければ取得し直せる。
// OPFS の同時書き込みは原子的ではないため、ブラウザーでは取得の前後を Web Locks で囲む想定（本体の接続側で行う）。

export const LOCK_FILE = '.tw-plus-lock.json';
export const DEFAULT_STALE_MS = 30_000;

export class ProjectLockedError extends Error {
  constructor(owner, heartbeatAt) {
    super(`project is locked by ${owner} (last heartbeat ${new Date(heartbeatAt).toISOString()})`);
    this.name = 'ProjectLockedError';
    this.code = 'ELOCKED';
    this.owner = owner;
    this.heartbeatAt = heartbeatAt;
  }
}

async function readLock(dir) {
  let handle;
  try {
    handle = await dir.getFileHandle(LOCK_FILE);
  } catch (error) {
    if (error?.name === 'NotFoundError' || error?.name === 'TypeMismatchError') return null;
    throw error;
  }
  try {
    const value = JSON.parse(await (await handle.getFile()).text());
    if (typeof value?.owner !== 'string' || typeof value?.heartbeatAt !== 'number') return null;
    return value;
  } catch {
    return null; // 壊れたロックは無いものとして扱う
  }
}

async function writeLock(dir, value) {
  const handle = await dir.getFileHandle(LOCK_FILE, { create: true });
  const writable = await handle.createWritable();
  await writable.write(new TextEncoder().encode(JSON.stringify(value)));
  await writable.close();
}

// 取得できれば、refresh と release を持つ記録を返す。他の owner が有効なロックを持つときは ProjectLockedError。
export async function acquireProjectLock(dir, { owner, now = Date.now(), staleMs = DEFAULT_STALE_MS } = {}) {
  if (typeof owner !== 'string' || owner === '') throw new Error('owner is required');
  const existing = await readLock(dir);
  if (existing && existing.owner !== owner && now - existing.heartbeatAt < staleMs) {
    throw new ProjectLockedError(existing.owner, existing.heartbeatAt);
  }
  const acquiredAt = existing && existing.owner === owner ? existing.acquiredAt : now;
  await writeLock(dir, { owner, acquiredAt, heartbeatAt: now });
  return {
    owner,
    async refresh(at = Date.now()) {
      await writeLock(dir, { owner, acquiredAt, heartbeatAt: at });
    },
    async release() {
      const current = await readLock(dir);
      if (current && current.owner === owner) {
        await dir.removeEntry(LOCK_FILE);
      }
    },
  };
}

// 状態だけを見る。書き込みはしない。
export async function inspectProjectLock(dir, { now = Date.now(), staleMs = DEFAULT_STALE_MS } = {}) {
  const existing = await readLock(dir);
  if (!existing) return { locked: false };
  return { locked: now - existing.heartbeatAt < staleMs, owner: existing.owner, heartbeatAt: existing.heartbeatAt };
}
