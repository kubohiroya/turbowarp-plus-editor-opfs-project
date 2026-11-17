# turbowarp-plus-editor-opfs-project

TurboWarp-Plus-Editor の作品を、ブラウザーの OPFS 上に「1作品1リポジトリ」として置くための
ライブラリです。現在は試作段階です。

- `createProjectRepository(root, {projectId, title, author})`：OPFS の `turbowarp-plus-projects/<projectId>/` に作品リポジトリを作り、初回コミットを作る。
- `src/opfs-git-fs.js`：OPFS のディレクトリを isomorphic-git の fs として使うアダプター（シンボリックリンク非対応）。

設計は turbowarp-plus-packages の `docs/opfs-project-storage.ja.md` を参照してください。

未実装: ロックファイル、SB3 の入出力、GitHub の push と pull、Editor 側の設定。

## テスト

```sh
npm install
npm test
```

テストは OPFS の代わりにフェイクのディレクトリ実装を使います。実際の Chromium の OPFS での確認は別途必要です。
