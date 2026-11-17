import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { zipSync, unzipSync } from 'fflate';
import { asFake, FakeDirectory } from './fake-opfs.ts';
import { createProjectRepository, openProjectDirectory } from '../src/project-repository.ts';
import { importSb3Archive, exportSb3Archive } from '../src/project-sb3.ts';
import { acquireProjectLock, ProjectLockedError, LOCK_FILE } from '../src/project-lock.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): Promise<Uint8Array> => readFile(path.join(here, 'fixtures', name));
const author = { name: 'Hiroya Kubo', email: 'hiroya@cuc.ac.jp' };

// 試作用の SB3 ビルダー。実際の編集側では、作品の変換（source → project.json）を含む処理に差し替える。
function zipBuilder(files: Map<string, Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, bytes] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) entries[name] = bytes;
  return zipSync(entries);
}

async function setupProject(root: FakeDirectory, projectId = 'p1'): Promise<void> {
  await createProjectRepository(root, { projectId, title: 'テスト', author });
}

test('importing a SB3 writes a source-format folder and commits it once', async () => {
  const root = new FakeDirectory();
  await setupProject(root);
  const result = await importSb3Archive(root, { projectId: 'p1', bytes: await fixture('ball-demo.sb3'), author, owner: 'tab-a', now: 1 });
  assert.equal(result.changed, true);
  assert.ok(result.files.includes('project.source.json'));
  assert.ok(result.files.includes('sb3-source.json'));
  assert.ok(result.files.some((f) => f.startsWith('assets/') && f.endsWith('.svg')));
  const dir = asFake(await openProjectDirectory(root, 'p1'));
  assert.equal(dir.children.has(LOCK_FILE), false, 'the lock is released after import');
  assert.equal(dir.children.has('.gitignore'), true, 'the gitignore is kept');
});

test('importing the same SB3 again makes no new commit', async () => {
  const root = new FakeDirectory();
  await setupProject(root);
  const bytes = await fixture('ball-demo.sb3');
  await importSb3Archive(root, { projectId: 'p1', bytes, author, owner: 'tab-a', now: 1 });
  const again = await importSb3Archive(root, { projectId: 'p1', bytes, author, owner: 'tab-a', now: 2 });
  assert.equal(again.changed, false);
});

test('export round-trips the folder contents through the injected builder', async () => {
  const root = new FakeDirectory();
  await setupProject(root);
  const bytes = await fixture('ball-demo.sb3');
  await importSb3Archive(root, { projectId: 'p1', bytes, author, owner: 'tab-a', now: 1 });
  const exported = await exportSb3Archive(root, { projectId: 'p1', buildArchive: zipBuilder });
  const names = Object.keys(unzipSync(exported)).sort();
  assert.ok(names.includes('project.source.json'));
  assert.ok(!names.includes(LOCK_FILE));
  assert.ok(!names.includes('.gitignore'));
  assert.ok(!names.includes('.git'));
});

test('export never includes the lock file', async () => {
  const root = new FakeDirectory();
  await setupProject(root);
  const dir = asFake(await openProjectDirectory(root, 'p1'));
  const lock = await acquireProjectLock(dir, { owner: 'tab-a', now: 1 });
  const exported = await exportSb3Archive(root, { projectId: 'p1', buildArchive: zipBuilder });
  assert.equal(Object.keys(unzipSync(exported)).includes(LOCK_FILE), false);
  await lock.release();
});

test('import is refused while another owner holds a fresh lock, and the tree is untouched', async () => {
  const root = new FakeDirectory();
  await setupProject(root);
  const dir = asFake(await openProjectDirectory(root, 'p1'));
  const before = [...dir.children.keys()].sort();
  const lock = await acquireProjectLock(dir, { owner: 'tab-a', now: 1000, staleMs: 30000 });
  await assert.rejects(
    importSb3Archive(root, { projectId: 'p1', bytes: await fixture('ball-demo.sb3'), author, owner: 'tab-b', now: 2000, staleMs: 30000 }),
    (e) => e instanceof ProjectLockedError,
  );
  assert.deepEqual([...dir.children.keys()].sort(), [...before, LOCK_FILE].sort());
  await lock.release();
});

test('invalid SB3 input is rejected and the lock is released', async () => {
  const root = new FakeDirectory();
  await setupProject(root);
  await assert.rejects(importSb3Archive(root, { projectId: 'p1', bytes: new Uint8Array([1, 2, 3]), author, owner: 'tab-a', now: 1 }));
  const dir = asFake(await openProjectDirectory(root, 'p1'));
  assert.equal(dir.children.has(LOCK_FILE), false);
});
