# Starboard: Preview Fix + gitBusy Publish-to-GitHub

## Goal

Land two things in one session:

1. Fix the repo preview card snap-back to OpenCut when selecting a different repo.
2. Add **gitBusy** — a publish-to-GitHub workflow for the local folder browser.

The companion app artifact is still called Starboard. The publish feature itself is the part the user named `gitBusy`.

---

## 1. Repo preview disappearing — fix

### Root cause

`src/App.tsx`:

- `selectedRepo` is a `find` over the active collection. During a starred snapshot reload the collection reference can briefly not contain the just-selected repo.
- The `selectedRepo.name` access in the breadcrumb and a few other places renders `Cannot read properties of undefined (reading 'name')` and the panel collapses to a fall-back repo.
- The `key={selectedRepo.id}` on `RepoDetail` does not change when the selected ID does, so the panel keeps its old state instead of rebuilding.

### Exact patch

1. **`src/App.tsx` ~line 250**
   ```ts
   const selectedRepo = collectionRepos.find((repo) => repo.id === selectedId)
   ```
   No fallback. The `selectedRepo` may be `undefined` during reload. Render guards handle it.

2. **`src/App.tsx` ~line 575** — keep the `selectedRepo &&` guard on `RepoDetail`:
   ```tsx
   {selectedRepo && detailOpen && !(activeSection === 'repos' && (myReposLoading || myReposError || myRepos.length === 0)) && (
     <RepoDetail key={selectedRepo.id} repo={selectedRepo} ... />
   )}
   ```

3. **`src/App.tsx` `selectRepo` ~line 416** — set the ref, then synchronously update state, then push the URL hash:
   ```ts
   const selectRepo = (repoId: string) => {
     selectedIdRef.current = repoId
     setSelectedId(repoId)
     setDetailTab('Overview')
     setDetailOpen(true)
     setDetailError(false)
     setDetailLoading(false)
     const repoHash = activeSection === 'repos' ? `#repos/${repoId}` : `#library/${repoId}`
     if (window.location.hash !== repoHash) window.history.pushState(null, '', repoHash)
   }
   ```

4. **`src/components/RepoCard.tsx`** — render the card body as a native link with the right `href`:
   ```tsx
   <a className="repo-card__body"
      href={href}
      onPointerDown={onSelect}
      onClick={onSelect}
      aria-label={`Open ${repo.owner}/${repo.name}`}>
   ```
   The parent passes the right `href` based on the active section:
   ```tsx
   href={activeSection === 'repos' ? `#repos/${repo.id}` : `#library/${repo.id}`}
   ```

5. Manual verify: click `OpenCut`, see preview with OpenCut. Click `datasciencecoursera`, see preview swap to `datasciencecoursera`. The breadcrumb reads:
   ```
   Starboard > Your library > datasciencecoursera
   ```
   No flash back to OpenCut.

### Build/lint gate

- `npm run build` returns 0
- `npm run lint` returns 0
- `git commit -m "fix: stabilize repo preview selection"`

---

## 2. gitBusy — publish local folder to GitHub

### Constraint

- Same-origin Vite middleware. The credential helper is read server-side. The browser never sees the token.
- The browser cannot run `git push`. We use the GitHub REST API to create a new repo and upload files via the Git Database API (blobs + trees + commits).
- All file content is UTF-8 text. Binary files are skipped with a clear report.

### 2.1 New backend endpoint (`server/githubProxy.ts`)

#### Request

```http
POST /api/github/publish-folder
Content-Type: application/json

{
  "name": "my-new-repo",
  "description": "optional",
  "isPrivate": true,
  "addGitignore": "Node",
  "commitMessage": "Add my-new-repo from Starboard",
  "files": [
    { "path": "src/index.js", "content": "console.log('hi')" }
  ]
}
```

#### Validation

- `name` must match `^[a-zA-Z0-9._-]+$`, length 1..100. Reject `..` and `.git`. Return `400` on failure.
- `isPrivate` must be boolean.
- `files` array required, can be empty.
- Skip any file whose UTF-8 byte length > 95 MB and include in `filesSkipped`.

#### Server flow

1. `authHeader()` via the macOS credential helper.
2. If repo exists, return `409` with `message: "Repository name already exists"`. The UI lets the user rename.
3. `POST /user/repos` with the create payload. `auto_init: true` so we have a base commit to attach a tree to.
4. Poll for the default branch with a 500ms retry; if the repo was just created, the first GET can return `404` until GitHub finishes provisioning.
5. Batch all files into a single commit:
   - `GET /repos/{owner}/{name}/git/ref/heads/{branch}` → base commit SHA.
   - `GET /repos/{owner}/{name}/git/commits/{sha}` → base tree SHA.
   - For each file, `POST /repos/{owner}/{name}/git/blobs` with `encoding: "utf-8"`, `content: <file text>`. Collect blob SHAs.
   - `POST /repos/{owner}/{name}/git/trees` with `base_tree: <baseTreeSha>` and `tree: [{ path, mode: "100644", type: "blob", sha: <blobSha> }, ...]`.
   - `POST /repos/{owner}/{name}/git/commits` with `message`, `tree: <newTreeSha>`, `parents: [<baseCommitSha>]`.
   - `PATCH /repos/{owner}/{name}/git/refs/heads/{branch}` with `sha: <newCommitSha>`.
6. Return:
   ```ts
   {
     html_url: string
     full_name: string
     default_branch: string
     filesUploaded: number
     filesSkipped: { path: string; reason: string }[]
     warnings: string[]
   }
   ```

#### `.gitignore` templates

- `Node`: `node_modules\ndist\n.env\n.DS_Store\n`
- `Python`: `__pycache__/\n*.pyc\n.venv/\n.env\n.DS_Store\n`
- `Go`: `*.exe\n*.dll\n*.so\n*.dylib\n.bin/\n`
- `Java`: `target/\n*.class\n*.jar\n.DS_Store\n`
- `Empty`: `\n`

### 2.2 New types and client (`src/components/PublishDialog.tsx`)

#### Form

- **Repo name** (text input). Default: `starboard-<sanitized-folder-name>`. Strip invalid chars. Max 100. Auto-suggest but allow override.
- **Description** (text input, optional).
- **Visibility** (radio): **Public** / **Private**. Default: Public.
- **Initialize with** (select): Node / Python / Go / Java / Empty. Default: Node.
- **Commit message** (text input). Default: `Add <repo-name> from Starboard`.
- **Files preview** (scrollable): file count, total size, list of paths.

#### File selection

- Source: `localFolders` filtered by `selectedFolderIds`.
- Skip list (binary extensions):
  `.png .jpg .jpeg .gif .webp .pdf .zip .tar .gz .tgz .dmg .iso .mp4 .mov .mp3 .wav .woff .woff2 .ttf .otf .ico .class .o .so .dylib .exe .bin`
- Also skip: `node_modules`, `.git`, `.DS_Store`.
- Show count of skipped binaries in the dialog.

#### Submit

```ts
fetch('/api/github/publish-folder', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, description, isPrivate, addGitignore, commitMessage, files })
})
```

- Show progress (loading, success, error).
- On success: close dialog, toast, show link.
- On 409 (name already exists): highlight the name field, show "Repository name already exists. Choose a different name."

### 2.3 UI hook into FolderWorkspace (`src/components/FolderWorkspace.tsx`)

Add a **Publish to GitHub** button next to the "Add folder" button. Disabled when no folder is added. Opens `PublishDialog` with the pre-filled file list.

```tsx
<button onClick={() => setShowPublish(true)} disabled={folders.length === 0}>
  <UploadCloud size={15} /> Publish to GitHub
</button>
```

`PublishDialog` receives:

```ts
{
  folders: LocalFolder[]
  selectedFolderIds: string[]
  onClose: () => void
  onPublished?: (result) => void
}
```

### 2.4 README content (no extra round trip)

The first commit message and the initial commit both include a `README.md` generated from the description. The body is plain Markdown with the folder summary.

```
# <repo-name>

Imported from Starboard on <date>.

## Folders included
- <folder-name> (<fileCount> files)
```

### 2.5 Final form payload shape

```ts
type PublishBody = {
  name: string
  description?: string
  isPrivate: boolean
  addGitignore: 'Node' | 'Python' | 'Go' | 'Java' | 'Empty'
  commitMessage: string
  files: { path: string; content: string }[]
}
```

`files[].content` is UTF-8 text. Binary files are not included.

---

## 3. Order of operations

1. Fix preview (`src/App.tsx` and `src/components/RepoCard.tsx`).
2. `npm run build` and `npm run lint`.
3. Commit preview fix.
4. Add backend `POST /api/github/publish-folder` in `server/githubProxy.ts`.
5. Add `PublishDialog` in `src/components/PublishDialog.tsx` and styles.
6. Wire the dialog into `FolderWorkspace`.
7. Add `gitignore-template.ts` helper with Node / Python / Go / Java / Empty.
8. `npm run build`, `npm run lint`, manual end-to-end on a real small folder.
9. Commit publish feature with message `feat: add gitBusy folder publish to GitHub`.
10. Update the `github-star-manager-build` skill with the publish section.
11. Append a "gitBusy" section to the existing Trilium note `uJeNWxOl1Eu3`.

---

## 4. Verification gates

- `npm run build` returns 0.
- `npm run lint` returns 0.
- Clicking a non-OpenCut repo card swaps the preview, never flashes back to OpenCut.
- `curl -X POST` against `/api/github/publish-folder` succeeds on a real test folder and returns a real `html_url`.
- The dialog handles the "name already exists" case with a clear message.
- Binary files are listed as skipped, not silently dropped.
- The created repo appears in the GitHub UI within ~10 seconds and contains every uploaded file at the right path.

---

## 5. Things the next session must not do

- Do not move the GitHub token to the browser.
- Do not switch the publish flow to a separate `git push` shell command.
- Do not add the publish UI to the starred library.
- Do not enable gitLargeFileStorage on the created repository. We only upload UTF-8 text and skip large files.
- Do not commit secrets. The publish payload is text only.

---

## 6. Open user questions before submit

1. **Folder name collision**: if the user already has a GitHub repo with the same name, do you want the UI to (a) refuse and ask for a new name, or (b) auto-suffix like `-2`, `-3`? I recommend (a) for safety. **Defaulting to (a) until told otherwise.**
2. **Default visibility**: do you want the dialog to remember the last choice and default to that, or always start on "Public"? **Defaulting to Public.**

If the user answers in the same message, build with their answer. Otherwise build with the defaults above and let them change later via the dialog.

---

## 7. Files touched (final)

| File | Change |
|---|---|
| `src/App.tsx` | Fix `selectedRepo` definition, guard detail render, update `selectRepo` |
| `src/components/RepoCard.tsx` | Use `<a href>` + onSelect for body, keep `<button>` for actions |
| `server/githubProxy.ts` | Add `POST /api/github/publish-folder` |
| `src/components/PublishDialog.tsx` | New file |
| `src/components/FolderWorkspace.tsx` | Add Publish button + wire dialog |
| `src/styles/folders.css` | Publish dialog styles |
| `src/gitignore-templates.ts` | Node / Python / Go / Java / Empty templates |
| `src/components/PublishDialog.css` (or shared in folders.css) | Layout |
| `~/.hermes/profiles/amae/skills/software-development/github-star-manager-build/SKILL.md` | Add gitBusy section |
| Trilium note `uJeNWxOl1Eu3` | Append gitBusy section |

---

## 8. Handoff details

- Working tree: `/Users/ellannjohnson/stargazer-local`
- Last commit before this handoff: `e275569 fix: stabilize repo preview selection`
- The Starboard server can be started with:
  ```bash
  open ~/Desktop/Starboard.app
  ```
- The local GitHub credential helper is already configured and verified.
- The local Trilium MCP is reachable at `http://localhost:37840/mcp`.
- The published note ID is `uJeNWxOl1Eu3` under the GitHub parent note `8nm7f2Td5zgZ`.

The next session should be able to start by reading this document, running `git log -1` to confirm the current state, and picking up at step 1 of section 3.

---

## 9. Implementation status after the handoff

Implementation commit: `befad0a2343ac9a3fcd30d51dbb9cb0b0147fb6f` (`feat: add gitBusy folder publish workflow`)

The `gitBusy` UI and server route are now implemented. The Folders workspace has a visible Publish to GitHub action, supports the selected local folders, scans UTF-8 text files, reports skipped binaries and large files, offers repository name, description, Public/Private visibility, gitignore template, and commit message controls, and requires the user to press the final Publish button.

No valid publish request has been sent. EJ is not ready to create a GitHub repository yet. Verification used only an unsafe-name POST, which returned HTTP 400 before credential lookup, and a GET, which returned HTTP 405. No GitHub repository, branch, commit, blob, or tree was created by this session.

The publish endpoint is `/api/github/publish-folder`. It reads the existing macOS Git credential helper only in the Vite server process. It creates a repository through the authenticated `/user/repos` route with `auto_init: false`, creates one tree and exactly one root commit with no parent, sets both `author` and `committer` from the authenticated GitHub profile, creates the branch reference, and reads the reference back to verify the new commit. The endpoint rejects `Co-authored-by` trailers, refuses a returned owner different from the authenticated account, and publishes only to the authenticated personal account. It does not accept an organization destination.

The default visibility is Public. Repository name collisions are intended to return HTTP 409 and require a different name. The browser sends only file paths and UTF-8 text content to the same-origin local endpoint; credentials never enter React, browser storage, project files, or Trilium. Generated `.gitignore` and README files are added only when the folder does not already contain them.

Current verification: `npm run build` passed; `npm run lint` passed with no warnings; the unsafe publish probe returned HTTP 400; the method gate returned HTTP 405; source inspection confirmed `auto_init: false`, `parents: []`, explicit `author` and `committer`, and no valid publish call. Native click-through browser verification remains pending because this runtime cannot attach to Helium's non-Chromium default profile.

The prior preview fallback was also removed: `selectedRepo` now resolves strictly by selected ID, with no first-repository fallback during collection reloads. The detail render remains guarded until the selected repository exists. The browser server was restarted after the source changes.

The user’s explicit publish constraint overrides the original auto-init handoff plan: only the authenticated user may be the author and committer, and the new repository must contain only that one user-authored root commit. Do not send a real publish request until EJ explicitly approves it.

---

## 10. Verified preview identity fix

Commit: `4774079 fix: preserve repo identity during detail fetch`

The remaining preview failure came from the detail merge, not from the card click. The GitHub detail endpoint returns repository `id` as a number, while the library model stores IDs as strings. Spreading the detail response over a `Repo` replaced the string ID with the numeric ID. The next render could no longer satisfy `repo.id === selectedId`, so the selected preview unmounted and the selected-card state became invalid.

The merge now compares IDs through `String(repo.id)` and writes the original normalized string ID, owner, and name back after applying detail metadata. The first-repo fallback remains removed, so a missing selection cannot silently become OpenCut.

Live Helium verification on 2026-09-02: the Starboard tab was opened at `#library`, the `Tsitko/datasciencecoursera` card was clicked, the address changed to `#library/30251453`, the breadcrumb changed to `datasciencecourse`, the right preview showed `datasciencecourse`, and after a five-second README/detail wait the preview and library cards were still present. The native browser driver initially targeted Helium’s New Tab and a bookmark menu; that was a test-tool targeting error, not an app result.
