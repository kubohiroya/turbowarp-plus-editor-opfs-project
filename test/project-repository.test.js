import { test } from 'node:test';
import assert from 'node:assert/strict';
import git from 'isomorphic-git';
import { FakeDirectory } from './fake-opfs.js';
import { createProjectRepository, openProjectDirectory, PROJECT_FILE } from '../src/project-repository.js';
import { createGitFs } from '../src/opfs-git-fs.js';

const author = { name: 'Hiroya Kubo', email: 'hiroya@cuc.ac.jp' };

test('creates a project repository in OPFS with one initial commit on main', async () => {
  const root = new FakeDirectory();
  const { commit } = await createProjectRepository(root, { projectId: 'p1', title: 'テスト作品', author });
  const dir = await openProjectDirectory(root, 'p1');
  const fs = createGitFs(dir);
  assert.equal(await git.currentBranch({ fs, dir: '/' }), 'main');
  const log = await git.log({ fs, dir: '/' });
  assert.equal(log.length, 1);
  assert.equal(log[0].oid, commit);
  assert.equal(log[0].commit.author.name, 'Hiroya Kubo');
  const files = await git.listFiles({ fs, dir: '/' });
  assert.deepEqual(files.sort(), ['.gitignore', PROJECT_FILE]);
  const json = JSON.parse(await fs.promises.readFile(`/${PROJECT_FILE}`, 'utf8'));
  assert.equal(json.meta.title, 'テスト作品');
});

test('refuses to overwrite an existing project repository', async () => {
  const root = new FakeDirectory();
  await createProjectRepository(root, { projectId: 'p2', title: 'a', author });
  await assert.rejects(createProjectRepository(root, { projectId: 'p2', title: 'b', author }), (e) => e.code === 'EEXIST');
});

test('rejects project ids that are not plain path segments', async () => {
  await assert.rejects(createProjectRepository(new FakeDirectory(), { projectId: '../x', title: 'a', author }));
});

test('a new asset in a nested folder can be committed and read back', async () => {
  const root = new FakeDirectory();
  await createProjectRepository(root, { projectId: 'p3', title: 'a', author });
  const dir = await openProjectDirectory(root, 'p3');
  const fs = createGitFs(dir);
  await fs.promises.writeFile('/assets/hello.txt', 'こんにちは');
  await git.add({ fs, dir: '/', filepath: 'assets/hello.txt' });
  await git.commit({ fs, dir: '/', message: 'Add asset', author });
  const log = await git.log({ fs, dir: '/' });
  assert.equal(log.length, 2);
  assert.equal(await fs.promises.readFile('/assets/hello.txt', 'utf8'), 'こんにちは');
  const status = await git.statusMatrix({ fs, dir: '/' });
  assert.ok(status.every(([, head, workdir, stage]) => head === workdir && workdir === stage));
});
