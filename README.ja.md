# turbowarp-plus-editor-opfs-project

TurboWarp-Plus-Editor の作品を、ブラウザーの OPFS 上に「1作品1リポジトリ」として置くための
ライブラリです。現在は試作段階です。

English: [README.md](README.md)TypeScript で書かれており、`npm run build` で `dist/` に JS と型定義を出力します。

関数が受け取るディレクトリは、ブラウザーの `FileSystemDirectoryHandle` をそのまま渡せます（型は `src/opfs-types.ts` の最小限の `DirectoryHandle`）。

- `createProjectRepository(root, {projectId, title, author})`：OPFS の `turbowarp-plus/projects/<projectId>/` に作品リポジトリを作り、初回コミットを作る。
- `acquireProjectLock(dir, {owner})`：作品ディレクトリ直下の `.tw-plus-lock.json` によるロック。heartbeat が 30 秒より古ければ取り直せる。
- `importSb3Archive(root, {projectId, bytes, author, owner})`：SB3 を形式 v1 の作品フォルダに展開して作業ツリーへ入れ、変更があれば `Import SB3` をコミットする。ロック中は拒否。
- `exportSb3Archive(root, {projectId, buildArchive})`：作業ツリーのファイルを集め、呼び出し側の `buildArchive` で SB3 にする。SB3 への変換は編集側の処理に任せる。
- `createGitFs(dir)`（`src/opfs-git-fs.ts`）：OPFS のディレクトリを isomorphic-git の fs として使うアダプター（シンボリックリンク非対応）。

設計は turbowarp-plus-packages の `docs/opfs-project-storage.ja.md` を参照してください。

未実装: GitHub の push と pull、Editor 側の設定と Web Locks による取得の囲み。

## テスト

```sh
npm install
npm run typecheck
npm test
npm run build
```

テストは Node の型除去機能で `.ts` を直接実行します（Node 22.18 以上）。

テストは OPFS の代わりにフェイクのディレクトリ実装を使います。SB3 の入出力は `test/fixtures` の実際の SB3 で確かめています。実際の Chromium の OPFS での確認は別途必要です。

## ライセンス

MPL-2.0（`LICENSE`）。
