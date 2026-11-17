import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FakeDirectory } from './fake-opfs.ts';
import { createProjectRepository } from '../src/project-repository.ts';
import { importSb3Archive, exportSb3Archive } from '../src/project-sb3.ts';
import { withProjectMutex, projectMutexName } from '../src/project-mutex.ts';
import type { LockManagerLike } from '../src/project-mutex.ts';
import { acquireProjectLock, inspectProjectLock, startLockHeartbeat } from '../src/project-lock.ts';
import { openProjectDirectory } from '../src/project-repository.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): Promise<Uint8Array> => readFile(path.join(here, 'fixtures', name));
const author = { name: 'Hiroya Kubo', email: 'hiroya@cuc.ac.jp' };

// 同じ名前の要求を一つずつ直列に実行する、Web Locks の代わり。呼ばれた要求を記録する。
function fakeLocks() {
  const tails = new Map<string, Promise<unknown>>();
  const requests: string[] = [];
  const manager: LockManagerLike = {
    request<T>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<T> | T): Promise<T> {
      requests.push(`${name}:${options.mode}`);
      const previous = tails.get(name) ?? Promise.resolve();
      const next = previous.catch(() => undefined).then(() => callback());
      tails.set(name, next);
      return next;
    },
  };
  return { manager, requests };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('the mutex name is derived from the project id', () => {
  assert.equal(projectMutexName('p1'), 'tw-plus-project:p1');
  assert.throws(() => projectMutexName('../etc'));
});

test('without a lock manager the callback runs directly', async () => {
  const value = await withProjectMutex('p1', () => 42, { locks: undefined });
  assert.equal(value, 42);
});

test('the mutex runs callbacks for the same project one after another', async () => {
  const { manager } = fakeLocks();
  const order: string[] = [];
  const first = withProjectMutex('p1', async () => {
    order.push('first start');
    await sleep(20);
    order.push('first end');
  }, { locks: manager });
  const second = withProjectMutex('p1', async () => {
    order.push('second start');
  }, { locks: manager });
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first start', 'first end', 'second start']);
});

test('import and export request the project mutex in exclusive mode', async () => {
  const root = new FakeDirectory();
  await createProjectRepository(root, { projectId: 'p1', title: 'テスト', author });
  const { manager, requests } = fakeLocks();
  await importSb3Archive(root, { projectId: 'p1', bytes: await fixture('ball-demo.sb3'), author, owner: 'tab-a', now: 1, locks: manager });
  await exportSb3Archive(root, { projectId: 'p1', buildArchive: (files) => files.size, locks: manager });
  assert.deepEqual(requests, ['tw-plus-project:p1:exclusive', 'tw-plus-project:p1:exclusive']);
});

test('a heartbeat refreshes the lock until it is stopped', async () => {
  const root = new FakeDirectory();
  await createProjectRepository(root, { projectId: 'p1', title: 'テスト', author });
  const dir = await openProjectDirectory(root, 'p1');
  const lock = await acquireProjectLock(dir, { owner: 'tab-a', now: 1000 });
  const stop = startLockHeartbeat(lock, { intervalMs: 5 });
  await sleep(40);
  stop();
  const after = await inspectProjectLock(dir, { now: Date.now() });
  assert.equal(after.locked, true);
  assert.ok(after.heartbeatAt !== undefined && after.heartbeatAt > 1000, 'the heartbeat moved forward');
  await lock.release();
});
