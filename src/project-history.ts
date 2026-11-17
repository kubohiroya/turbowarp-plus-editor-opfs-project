import git from 'isomorphic-git';
import type { FsClient } from 'isomorphic-git';
import { codedError } from './opfs-types.ts';

// 作品の履歴を git bundle（v2 形式）として作る。作業ツリーの .git は含めない。
// 出力は `git bundle verify` と `git clone <file>` で読める形式。
export const HISTORY_BUNDLE_PATH = 'tw-plus/history.bundle';

const BUNDLE_SIGNATURE = '# v2 git bundle\n';

export interface HistoryBundleRef {
  name: string;
  oid: string;
}

export interface HistoryBundle {
  bytes: Uint8Array;
  refs: HistoryBundleRef[];
  commitCount: number;
}

async function collectRefs(fs: FsClient, dir: string): Promise<HistoryBundleRef[]> {
  const refs: HistoryBundleRef[] = [];
  const head = await git.resolveRef({ fs, dir, ref: 'HEAD' }).catch(() => null);
  if (head === null) return refs;
  refs.push({ name: 'HEAD', oid: head });
  for (const branch of await git.listBranches({ fs, dir })) {
    const oid = await git.resolveRef({ fs, dir, ref: `refs/heads/${branch}` });
    refs.push({ name: `refs/heads/${branch}`, oid });
  }
  return refs;
}

// 参照先から到達できるオブジェクト（コミット・ツリー・ブロブ）をすべて集める。
// packObjects は渡された oid だけを詰めるので、先に全体を歩いて列挙する。
async function collectObjects(fs: FsClient, dir: string, tips: string[]): Promise<{ oids: string[]; commits: string[] }> {
  const seen = new Set<string>();
  const commits: string[] = [];
  const queue = [...tips];
  while (queue.length > 0) {
    const oid = queue.pop() as string;
    if (seen.has(oid)) continue;
    seen.add(oid);
    const { commit } = await git.readCommit({ fs, dir, oid });
    commits.push(oid);
    queue.push(...commit.parent);
    await collectTree(fs, dir, commit.tree, seen);
  }
  return { oids: [...seen], commits };
}

async function collectTree(fs: FsClient, dir: string, oid: string, seen: Set<string>): Promise<void> {
  if (seen.has(oid)) return;
  seen.add(oid);
  const { tree } = await git.readTree({ fs, dir, oid });
  for (const entry of tree) {
    if (entry.type === 'tree') {
      await collectTree(fs, dir, entry.oid, seen);
    } else if (entry.type === 'blob') {
      seen.add(entry.oid);
    }
  }
}

// 履歴の bundle を作る。コミットが一つもなければ ENOHISTORY を投げる。
export async function createHistoryBundle(fs: FsClient, dir: string): Promise<HistoryBundle> {
  const refs = await collectRefs(fs, dir);
  if (refs.length === 0) throw codedError('project has no history yet', 'ENOHISTORY');
  const tips = [...new Set(refs.map((ref) => ref.oid))];
  const { oids, commits } = await collectObjects(fs, dir, tips);
  const { packfile } = await git.packObjects({ fs, dir, oids, write: false });
  if (!packfile) throw new Error('packObjects returned no packfile');
  const header = new TextEncoder().encode(
    BUNDLE_SIGNATURE + refs.map((ref) => `${ref.oid} ${ref.name}\n`).join('') + '\n',
  );
  const bytes = new Uint8Array(header.length + packfile.length);
  bytes.set(header, 0);
  bytes.set(packfile, header.length);
  return { bytes, refs, commitCount: commits.length };
}
