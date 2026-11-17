// 作品ごとの排他。ブラウザーでは Web Locks（navigator.locks）で、同じ作品を扱う他のタブとの読み書きを直列にする。
// Web Locks がない環境（テストや Node）では、そのまま実行する。
// 作品フォルダーのロックファイル（project-lock.ts）は、別のプロセスや持ち主の記録に使う。二つは役割が違う。

import { assertProjectId } from './project-repository.ts';

export interface LockManagerLike {
  request<T>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<T> | T): Promise<T>;
}

export function projectMutexName(projectId: string): string {
  assertProjectId(projectId);
  return `tw-plus-project:${projectId}`;
}

function defaultLockManager(): LockManagerLike | undefined {
  const nav = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator;
  return nav?.locks;
}

export interface WithProjectMutexOptions {
  locks?: LockManagerLike | undefined;
}

export async function withProjectMutex<T>(
  projectId: string,
  run: () => Promise<T> | T,
  { locks = defaultLockManager() }: WithProjectMutexOptions = {},
): Promise<T> {
  const name = projectMutexName(projectId);
  if (!locks) return run();
  return locks.request(name, { mode: 'exclusive' }, run);
}
