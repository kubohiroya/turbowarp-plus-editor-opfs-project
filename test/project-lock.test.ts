import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDirectory } from './fake-opfs.ts';
import { acquireProjectLock, inspectProjectLock, LOCK_FILE, ProjectLockedError } from '../src/project-lock.ts';

test('a second owner is refused while the first heartbeat is fresh', async () => {
  const dir = new FakeDirectory();
  const first = await acquireProjectLock(dir, { owner: 'tab-a', now: 1000, staleMs: 30000 });
  await assert.rejects(acquireProjectLock(dir, { owner: 'tab-b', now: 2000, staleMs: 30000 }), (e) => e instanceof ProjectLockedError && e.owner === 'tab-a');
  await first.release();
});

test('the same owner can take the lock again and keeps its acquiredAt', async () => {
  const dir = new FakeDirectory();
  await acquireProjectLock(dir, { owner: 'tab-a', now: 1000 });
  const again = await acquireProjectLock(dir, { owner: 'tab-a', now: 5000 });
  const state = await inspectProjectLock(dir, { now: 5000 });
  assert.equal(state.locked, true);
  assert.equal(state.owner, 'tab-a');
  assert.equal(state.heartbeatAt, 5000);
  await again.release();
});

test('a stale lock is taken over', async () => {
  const dir = new FakeDirectory();
  await acquireProjectLock(dir, { owner: 'tab-a', now: 1000, staleMs: 30000 });
  const taken = await acquireProjectLock(dir, { owner: 'tab-b', now: 40000, staleMs: 30000 });
  assert.equal((await inspectProjectLock(dir, { now: 40000 })).owner, 'tab-b');
  await taken.release();
});

test('release removes only the lock owned by this record', async () => {
  const dir = new FakeDirectory();
  const a = await acquireProjectLock(dir, { owner: 'tab-a', now: 1000, staleMs: 1 });
  const b = await acquireProjectLock(dir, { owner: 'tab-b', now: 5000, staleMs: 1 });
  await a.release();
  assert.equal((await inspectProjectLock(dir, { now: 5000, staleMs: 30000 })).owner, 'tab-b');
  await b.release();
  assert.equal(dir.children.has(LOCK_FILE), false);
});

test('a corrupt lock file is treated as no lock', async () => {
  const dir = new FakeDirectory();
  const handle = await dir.getFileHandle(LOCK_FILE, { create: true });
  const writable = await handle.createWritable();
  await writable.write(new TextEncoder().encode('{not json'));
  await writable.close();
  assert.deepEqual(await inspectProjectLock(dir), { locked: false });
  const lock = await acquireProjectLock(dir, { owner: 'tab-a' });
  await lock.release();
});
