// 作品ディレクトリ直下のロックファイル。同じ作品を複数のプロセスで書かないための記録。
// 別のタブ・プロセスが取得したまま、heartbeat が staleMs より古ければ取得し直せる。
// OPFS の同時書き込みは原子的ではないため、ブラウザーでは取得の前後を Web Locks で囲む想定（本体の接続側で行う）。

import { writeBytes } from './opfs-types.ts';
import type { DirectoryHandle, FileHandle } from './opfs-types.ts';

export const LOCK_FILE = '.tw-plus-lock.json';
export const DEFAULT_STALE_MS = 30_000;

/** ロックファイルの中身。 */
export interface ProjectLockRecord {
  owner: string;
  acquiredAt: number;
  heartbeatAt: number;
}

export interface ProjectLock {
  readonly owner: string;
  refresh(at?: number): Promise<void>;
  release(): Promise<void>;
}

export interface AcquireProjectLockOptions {
  owner: string;
  now?: number | undefined;
  staleMs?: number | undefined;
}

export interface InspectProjectLockOptions {
  now?: number | undefined;
  staleMs?: number | undefined;
}

export type ProjectLockState =
  | { locked: false; owner?: undefined; heartbeatAt?: undefined }
  | { locked: boolean; owner: string; heartbeatAt: number };

export class ProjectLockedError extends Error {
  readonly code = 'ELOCKED';
  readonly owner: string;
  readonly heartbeatAt: number;

  constructor(owner: string, heartbeatAt: number) {
    super(`project is locked by ${owner} (last heartbeat ${new Date(heartbeatAt).toISOString()})`);
    this.name = 'ProjectLockedError';
    this.owner = owner;
    this.heartbeatAt = heartbeatAt;
  }
}

function errorName(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string' ? error.name : undefined;
}

async function readLock(dir: DirectoryHandle): Promise<ProjectLockRecord | null> {
  let handle: FileHandle;
  try {
    handle = await dir.getFileHandle(LOCK_FILE);
  } catch (error) {
    const name = errorName(error);
    if (name === 'NotFoundError' || name === 'TypeMismatchError') return null;
    throw error;
  }
  try {
    const value: unknown = JSON.parse(await (await handle.getFile()).text());
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Partial<ProjectLockRecord>;
    if (typeof record.owner !== 'string' || typeof record.heartbeatAt !== 'number') return null;
    return record as ProjectLockRecord;
  } catch {
    return null; // 壊れたロックは無いものとして扱う
  }
}

async function writeLock(dir: DirectoryHandle, value: ProjectLockRecord): Promise<void> {
  const handle = await dir.getFileHandle(LOCK_FILE, { create: true });
  await writeBytes(handle, new TextEncoder().encode(JSON.stringify(value)));
}

// 取得できれば、refresh と release を持つ記録を返す。他の owner が有効なロックを持つときは ProjectLockedError。
export async function acquireProjectLock(
  dir: DirectoryHandle,
  { owner, now = Date.now(), staleMs = DEFAULT_STALE_MS }: AcquireProjectLockOptions,
): Promise<ProjectLock> {
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
export async function inspectProjectLock(
  dir: DirectoryHandle,
  { now = Date.now(), staleMs = DEFAULT_STALE_MS }: InspectProjectLockOptions = {},
): Promise<ProjectLockState> {
  const existing = await readLock(dir);
  if (!existing) return { locked: false };
  return { locked: now - existing.heartbeatAt < staleMs, owner: existing.owner, heartbeatAt: existing.heartbeatAt };
}
