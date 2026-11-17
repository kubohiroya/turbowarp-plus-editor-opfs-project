// 型だけの確認: ブラウザーの OPFS ハンドルをこのライブラリの関数にそのまま渡せること。
import type { DirectoryHandle } from '../src/opfs-types.ts';
import { createProjectRepository } from '../src/project-repository.ts';

export async function acceptsBrowserHandle(root: FileSystemDirectoryHandle): Promise<void> {
  const handle: DirectoryHandle = root;
  await createProjectRepository(handle, { projectId: 'p', title: 't', author: { name: 'n', email: 'e' } });
}
