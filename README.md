# turbowarp-plus-editor-opfs-project

A library that keeps TurboWarp-Plus-Editor projects in the browser's Origin Private File System (OPFS), with one project per Git repository. It is at an early (experimental) stage.

- `createProjectRepository(root, {projectId, title, author})`: creates a project repository at `turbowarp-plus-projects/<projectId>/` in OPFS and makes the first commit.
- `acquireProjectLock(dir, {owner})`: a lock recorded in `.tw-plus-lock.json` in the project directory. A lock whose heartbeat is older than 30 seconds can be taken over.
- `importSb3Archive(root, {projectId, bytes, author, owner})`: expands an SB3 into a source-format v1 project folder in the working tree, and commits `Import SB3` if anything changed. Refused while another owner holds the lock.
- `exportSb3Archive(root, {projectId, buildArchive})`: collects the working-tree files and passes them to your `buildArchive` to produce an SB3. Converting source to SB3 is left to the editor side.
- `src/opfs-git-fs.js`: an adapter that uses an OPFS directory as the `fs` for isomorphic-git (symbolic links are not supported).

The design is in `docs/opfs-project-storage.ja.md` in turbowarp-plus-packages (in Japanese).

Not yet implemented: GitHub push and pull, and the editor settings. The editor must also wrap lock acquisition in Web Locks.

日本語版: [README.ja.md](README.ja.md)

## Test

```sh
npm install
npm test
```

Tests use a fake directory implementation instead of OPFS. SB3 import and export are checked with the real SB3 files in `test/fixtures`. Verification in a real Chromium OPFS is still needed.

## License

MPL-2.0 (see `LICENSE`).
