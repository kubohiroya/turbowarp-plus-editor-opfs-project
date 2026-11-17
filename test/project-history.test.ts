import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { zipSync, unzipSync } from 'fflate';
import { FakeDirectory } from './fake-opfs.ts';
import { createProjectRepository, openProjectDirectory } from '../src/project-repository.ts';
import { createGitFs } from '../src/opfs-git-fs.ts';
import { importSb3Archive, exportSb3WithHistory } from '../src/project-sb3.ts';
import { createHistoryBundle, HISTORY_BUNDLE_PATH } from '../src/project-history.ts';
import { acquireProjectLock, ProjectLockedError } from '../src/project-lock.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): Promise<Uint8Array> => readFile(path.join(here, 'fixtures', name));
const author = { name: 'Hiroya Kubo', email: 'hiroya@cuc.ac.jp' };

function zipBuilder(files: Map<string, Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, bytes] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) entries[name] = bytes;
  return zipSync(entries);
}

// 最初のコミット（Create）と、SB3 取り込みのコミット（Import SB3）の二つを持つ作品を作る。
async function setupProjectWithTwoCommits(root: FakeDirectory): Promise<void> {
  await createProjectRepository(root, { projectId: 'p1', title: 'テスト', author });
  await importSb3Archive(root, { projectId: 'p1', bytes: await fixture('ball-demo.sb3'), author, owner: 'tab-a', now: 1 });
}

async function verifyWithGit(bytes: Uint8Array): Promise<{ dir: string; bundlePath: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'tw-plus-bundle-'));
  const bundlePath = path.join(dir, 'history.bundle');
  await writeFile(bundlePath, bytes);
  return { dir, bundlePath };
}

test('the bundle has a v2 header, lists HEAD and main, and passes git bundle verify', async () => {
  const root = new FakeDirectory();
  await setupProjectWithTwoCommits(root);
  const dir = await openProjectDirectory(root, 'p1');
  const bundle = await createHistoryBundle(createGitFs(dir), '/');
  assert.equal(bundle.commitCount, 2);
  const text = new TextDecoder().decode(bundle.bytes.slice(0, 200));
  assert.ok(text.startsWith('# v2 git bundle\n'));
  assert.ok(text.includes(' refs/heads/main\n'));

  const { dir: tmp, bundlePath } = await verifyWithGit(bundle.bytes);
  try {
    const out = execFileSync('git', ['bundle', 'verify', bundlePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(out, /records a complete history/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('a clone from the bundle restores the working tree at the last commit', async () => {
  const root = new FakeDirectory();
  await setupProjectWithTwoCommits(root);
  const dir = await openProjectDirectory(root, 'p1');
  const bundle = await createHistoryBundle(createGitFs(dir), '/');
  const { dir: tmp, bundlePath } = await verifyWithGit(bundle.bytes);
  try {
    const dest = path.join(tmp, 'clone');
    execFileSync('git', ['clone', '--quiet', bundlePath, dest], { stdio: 'ignore' });
    const source = await readFile(path.join(dest, 'project.source.json'), 'utf8');
    assert.ok(source.length > 0);
    const log = execFileSync('git', ['-C', dest, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual(log, ['Import SB3', 'Create project テスト']);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('a repository without any commit has no history to bundle', async () => {
  const root = new FakeDirectory();
  const dir = await openProjectDirectory(root, 'p2', { create: true });
  await assert.rejects(createHistoryBundle(createGitFs(dir), '/'), (error: { code?: string }) => error.code === 'ENOHISTORY');
});

test('exporting with history adds tw-plus/history.bundle and keeps the working tree intact', async () => {
  const root = new FakeDirectory();
  await setupProjectWithTwoCommits(root);
  const result = await exportSb3WithHistory(root, {
    projectId: 'p1',
    buildArchive: zipBuilder,
    author,
    owner: 'tab-a',
    includeUncommitted: false,
    now: 2,
  });
  const entries = unzipSync(result.archive);
  assert.ok(entries[HISTORY_BUNDLE_PATH], 'the bundle is inside the SB3');
  assert.equal(result.commit, null, 'no commit without includeUncommitted');
  assert.equal(result.commitCount, 2);
  assert.ok(entries['project.source.json']);
  assert.equal(entries['.git'], undefined, 'the .git folder itself is not exported');
});

test('includeUncommitted records pending changes before the export', async () => {
  const root = new FakeDirectory();
  await setupProjectWithTwoCommits(root);
  const dir = await openProjectDirectory(root, 'p1');
  const handle = await dir.getFileHandle('notes.txt', { create: true });
  const writable = await handle.createWritable();
  await writable.write(new TextEncoder().encode('pending'));
  await writable.close();

  const result = await exportSb3WithHistory(root, {
    projectId: 'p1',
    buildArchive: zipBuilder,
    author,
    owner: 'tab-a',
    includeUncommitted: true,
    now: 3,
  });
  assert.ok(result.commit, 'a commit is made for the pending change');
  assert.equal(result.commitCount, 3);
});

test('includeUncommitted fails with ProjectLockedError while another owner holds the lock', async () => {
  const root = new FakeDirectory();
  await setupProjectWithTwoCommits(root);
  const dir = await openProjectDirectory(root, 'p1');
  const held = await acquireProjectLock(dir, { owner: 'tab-b', now: 10 });
  try {
    await assert.rejects(
      exportSb3WithHistory(root, { projectId: 'p1', buildArchive: zipBuilder, author, owner: 'tab-a', includeUncommitted: true, now: 11 }),
      ProjectLockedError,
    );
  } finally {
    await held.release();
  }
});
