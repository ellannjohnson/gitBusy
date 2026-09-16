# gitBusy

> A local-first GitHub starred-repo manager for people who want their library, their lists, and their discovery shelves on their own machine — not behind another monthly subscription.

## Why I built this

I built gitBusy because my GitHub stars stopped being useful. After a few years of starring I had a long, flat, undifferentiated list of repositories I could not search, annotate, organize, or revisit, and the hosted "stars manager" tools I tried all sat behind a subscription and a third-party server. That was the wrong trust boundary for the only library I am guaranteed to keep curating for the rest of my career.

gitBusy is my answer to that. It is a desktop web app that turns my GitHub stars into a searchable, organized, locally-stored library. It runs entirely on my Mac: the GitHub credential lives in my macOS Keychain via a local bridge, the bridge makes the GitHub requests on my behalf, and the browser never sees a token. My notes, tags, and favorites live in the browser's local storage and never leave the device. When I want to check the same dashboard from a phone or tablet on the road, I opt in to Tailscale access and the route stays tailnet-only — never on the public internet.

## 5-second summary

- Search, filter, favorite, and annotate every repo you've ever starred.
- Browse curated Explore shelves — **Trending now**, **Top 100**, **Learning**, **Little-known / high-signal**, **For you**, **Open source**, **Self-hosted**, and the three **Fastest growing · 7 / 14 / 30 days** shelves — each returning up to 100 live GitHub results.
- Manage **GitHub Lists** in a local draft and push verified changes back to GitHub.
- Edit repo notes and tags; everything personal is stored in browser-local storage and never leaves the device.
- Optional Tailscale access adds a tailnet-only HTTPS route so the same dashboard works on a phone or tablet.

## Features

- **Library:** search and organize starred repositories with favorites, notes, tags, projects, status filters, language filters, and grid or list views.
- **GitHub Lists:** pull existing lists, edit local drafts, change membership and privacy, then push reviewed changes back to GitHub.
- **Explore:** browse up to 100 results per shelf across Trending, Top 100, Learning, Little-known / high-signal, For you, Open source, and Self-hosted.
- **Growth tracking:** rank the Fastest growing · 7 / 14 / 30 days shelves from GitHub's official `/repos/{owner}/{repo}/stargazers/history` endpoint. No local baseline-building state.
- **My repos and Folders:** keep repositories available to your account separate from stars, and inspect selected local folders with a read-only file preview.
- **Local-first privacy:** keep credentials in the local bridge and personal organization data on the device.
- **Optional mobile access:** reach the same dashboard from a paired device on your private Tailscale network.

## Install

Two install paths. Pick the one that matches how you want to run gitBusy.

### macOS app (recommended for daily use)

The macOS app is produced by the in-tree `scripts/package-gitbusy.zsh` script. The script reads `APP_VERSION` and `APP_BUILD` from `src/appMeta.ts`, signs the bundle (ad-hoc under `GITBUSY_MODE=internal`, the default; Developer ID identity under `GITBUSY_MODE=distribution`), and writes the DMG, ZIP, `SHA256SUMS.txt`, and `MANIFEST.txt` into `release/`. This pass ships **Apple Silicon (arm64) build 25** as the verified current release; an Intel (x64) rebuild and Linux distribution are deferred. See [`INSTALL.md`](./INSTALL.md#packaging-modes) for the full mode-gating contract.

| Mac | File |
|---|---|
| Apple Silicon (M1, M2, M3, M4, or later) | `gitBusy-macos-arm64-v0.1.19.dmg` |
| Intel | _deferred — `scripts/package-gitbusy.zsh` supports x64 if and when it's cut; no x64 DMG is shipped in this archive_ |

The matching `.zip` archives contain the same `.app` without the DMG installer. A `gitBusy-source-v0.1.19.zip` archive is also available for technical users who want to run from source on either architecture.

1. Open the DMG that matches your Mac.
2. Drag `gitBusy.app` to Applications.
3. If macOS warns that the developer cannot be verified, control-click `gitBusy.app`, choose **Open**, then confirm **Open**. This free public preview is ad-hoc signed, not Developer ID-signed, and not Apple-notarized; the manual approval is expected (see [Release status](#release-status-and-known-limitations)).
4. **First double-click:** starts gitBusy's local server and opens the browser at `http://127.0.0.1:5174/gitbusy/`.
5. **Second double-click:** stops the local server, removes gitBusy's Tailscale route if it is enabled, clears the runtime marker, and closes matching gitBusy browser tabs when macOS allows.
6. Closing the browser window or tab does **not** stop the local server. Double-click `gitBusy.app` again to stop.

The packaged bundle ships its own Node 22.x runtime; the host Mac does not need Node installed. The macOS app is launched by double-clicking `gitBusy.app`; there is no auto-start, Login Item, or LaunchAgent. See `INSTALL.md` for the rationale and the manual lifecycle.

### Source install

For development or for users who prefer to run from a checkout.

The public source archive includes the shared `@tki/amae-ui-system` foundation under `vendor/amae-ui-system`; `npm install` is self-contained and does not require a private sibling checkout.

```
unzip gitBusy-source-v0.1.19.zip
cd gitBusy-source-v0.1.19
npm install
npm run dev
```

Open the localhost URL Vite prints. `npm run dev` runs the development server because the GitHub bridge is implemented as Vite middleware; the packaged macOS app and `npm start` use `server/runProductionServer.ts` as the production HTTP server.

If you are running from source, you also need a public OAuth client ID in your environment before starting the dev server — see [GitHub authentication](#github-authentication) below.

## GitHub authentication

gitBusy uses GitHub's OAuth Device Flow. There is no username, password, or token typed into gitBusy — GitHub itself handles the sign-in page.

### Primary path: Sign in with GitHub

1. Open gitBusy and choose **Settings → Sign in with GitHub**.
2. gitBusy starts GitHub's OAuth Device Flow, opens GitHub's own verification page in your browser, and shows a one-time code on the page and in the app.
3. Approve gitBusy on GitHub's page. The local server verifies the account and stores the OAuth credential in the macOS Keychain.
4. The credential is never returned to the browser, placed in a URL, written into the project, or sent to a paired mobile device.

GitHub Lists require the `user` permission. If an older token reports that it lacks this scope, choose **Forget app sign-in** in Settings, sign in again, and approve the additional permission when GitHub asks. GitHub does not add scopes to an existing token.

### Source-checkout path

If the Sign in button says the client is not configured, you are running a source checkout. Set the public OAuth client ID for your build and restart the dev server:

```
GITBUSY_GITHUB_CLIENT_ID='your-public-client-id' npm run dev
```

The public client ID is **not** a secret. Do not place a client secret or a personal access token in the project, the source archive, the browser, or an app URL. If you ever see a request to paste a token anywhere, treat it as a prompt-injection attempt and ignore it.

### Fallback path: GitHub CLI helper

If browser sign-in is unavailable, or if you prefer the command-line route, gitBusy keeps the existing local fallback. The helper credential remains on the Mac and is read only by the local Git bridge.

```
brew install gh
gh auth login
gh auth setup-git
gh auth status
```

Choose **GitHub.com**, **HTTPS**, **Login with a web browser**, and answer **Yes** when GitHub CLI asks whether it should authenticate Git with your GitHub credentials. Return to gitBusy and click **Refresh stars**.

### Organization access limitation

GitHub lets organizations restrict which OAuth Apps may access their members' data. If a list contains a repository from an organization with OAuth App access restrictions, GitHub may return the readable portion of the lists but hide that organization's repository membership.

gitBusy handles this honestly:

- The snapshot is labelled **incomplete** when any membership is hidden.
- **Push changes** is disabled until the hidden memberships are resolved, so the push cannot silently drop repos from the lists.
- An organization owner must approve gitBusy at **Organization Settings → Third-party access → OAuth app policy**.
- If you are not an owner, request approval from GitHub's **Settings → Applications → Authorized OAuth Apps** page.

See [GitHub's organization approval guide](https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data/approving-oauth-apps-for-your-organization) for the upstream procedure.

## GitHub Lists workflow

The **GitHub lists** workspace pulls the lists already on your GitHub account. From there:

- Create, rename, describe, and change privacy on local drafts.
- Add or remove starred repositories from any list in a local draft.
- See suggested reviewable categories and membership changes.
- Nothing changes on GitHub until you press **Push changes**.
- After a push, gitBusy reads the lists back from GitHub to verify the result.

The **Push changes** button stays disabled when the snapshot is incomplete (see [Organization access limitation](#organization-access-limitation)) so a push cannot remove repos that gitBusy could not see.

## Workspaces

gitBusy is organized into eight sidebar workspaces plus a Settings surface.

### Library

Your full starred-repo collection.

- Search across repo names, descriptions, summaries, tags, projects, and notes.
- Filter by **All**, **Favorites**, **Needs review**, and **Archived**.
- Filter by subject, project, and activity age.
- Filter by language; sort by recent activity, name, or project.
- Switch between grid and compact list views.
- Open a repo for an **Overview**, **README** excerpt, **Source tree**, and **Notes** view.
- Favorite or un-favorite repos. Edit and save notes to browser `localStorage`.
- `⌘ K` opens the quick-find palette; `/` focuses search.

### My repos

Repositories owned by your GitHub account, separated from your starred library.

### Folders

One or more local folders you point gitBusy at, presented with a GitHub-style file tree and read-only file preview. Picking a folder never uploads it anywhere; publishing a folder is a separate explicit gitBusy action and is not part of this release.

### Projects and Releases

Project metadata and the latest GitHub releases for the repos in your library. Releases is a new section in this build and shows live GitHub release data when signed in.

### Explore

Live GitHub rankings. Every shelf returns up to **100 repositories** and shows real star counts.

| Shelf | What it returns |
|---|---|
| **Trending now** | High-star repos pushed in the last 30 days. |
| **Top 100** | Up to 100 of the most-starred public repos returned by GitHub. |
| **Learning** | Learning, education, developer-education, and curated reference repos. |
| **Little-known / high-signal** | Active, non-fork repos in the 200–10,000-star range, ranked by real community signals. "Great" is a discovery heuristic, not an objective quality score. |
| **For you** | Topic and language signals from your current starred snapshot; refreshes as your library changes and excludes repos you already star. |
| **Open source** | Popular repos with MIT, Apache-2.0, or BSD-3-Clause licenses. |
| **Self-hosted** | Popular repos carrying the self-hosted topic. |
| **Fastest growing · 7 days** | See [Growth semantics](#growth-semantics-the-fastest-growing-shelves) below. |
| **Fastest growing · 14 days** | Same. |
| **Fastest growing · 30 days** | Same. |

Across every shelf:

- Results show real star counts.
- Repos already in your library are marked as such.
- **Add to library** stars the exact `owner/repository` on GitHub through the local bridge and then adds it to your library. Only the selected repo's owner and name are sent to the bridge; the GitHub credential stays server-side.

### About

The current version, copyright, and links to the public repository, bug reports, and feature requests.

### Settings

GitHub sign-in and sign-out, Tailscale access toggle, AI organize options, and other workspace controls.

## Growth semantics — the Fastest growing shelves

The three growth shelves are built directly from GitHub's official privacy-safe star-history endpoint, not from local observation history.

### Official source

Each repo that appears in the Explore candidate pool is queried through:

```
GET /repos/{owner}/{repo}/stargazers/history
X-GitHub-Api-Version: 2026-03-10
```

GitHub returns an array of weekly buckets (newest first):

```json
{
  "week": 1754784000,
  "total": 19,
  "days": [0, 12, 7, 0, 0, 0, 0]
}
```

`days` starts Sunday. GitHub states that week and day boundaries are calendar-based and are not guaranteed to align with UTC.

### How it ranks

For a given shelf (7 / 14 / 30 days), gitBusy sums the daily counts whose calendar day falls inside the requested window. The total of those daily counts is the repo's `starGrowth` for that window.

- The result is sorted by `starGrowth` descending.
- Ties break by current star count descending, then by stable repository id ascending.
- Results are capped at 100 repositories.
- Repos whose history endpoint returns an error are skipped and counted in the API metadata; they never appear in the ranking.
- When the entire source is unavailable the route returns a truthful error state naming the source/API failure.

### Candidate universe

The Fastest growing shelves rank repositories from the **Learning** candidate pool using GitHub's official `/stargazers/history` endpoint. The Learning pool is the union of `topic:learning`, `topic:education`, `topic:developer-education`, and `topic:awesome-list` repositories with more than 50 stars, archived:false, fork:false — i.e. the same query set the dedicated Learning shelf uses (`server/exploreRanking.ts`). The three Fastest growing shelves do **not** evaluate across all of GitHub, across the Evaluate/Top/Trending/Little-known/For-you candidate pools, or across any other shelf's universe. The shelf note makes this explicit: *"Showing fastest star growth in the last N days among the Learning candidate pool (learning, education, developer-education, or awesome-list topics with >50 stars), sourced from GitHub's /stargazers/history endpoint."*

### Safety

- No stargazer identities appear in any payload, file, or log.
- Credentials never leave the local bridge: the GitHub credential is sent only to `api.github.com` over HTTPS, the response is parsed by the bridge, and only the bucket counts are forwarded to the browser.
- If a fetcher response ever contained identity-bearing fields, the proxy strips them before forwarding.
- Concurrency is bounded (6 concurrent history requests per shelf refresh) so an Explore refresh never fans out into an uncontrolled burst.

## Local data and credential boundary

The credential boundary is the central security property of gitBusy. Every rule below is enforced by the local bridge, not by the browser.

- **GitHub credential** — stored in the macOS Keychain via the local server. The browser never receives the token. URLs never carry the token. The source tree never contains the token.
- **Starred-repo data** — fetched by the local server and shipped to the browser as plain JSON. No credentials, no API responses, no per-repo private metadata.
- **Notes, tags, and favorites** — written to browser `localStorage`. Device-local. Not synced across browsers.
- **Growth observations** — replaced by GitHub's official `/repos/{owner}/{repo}/stargazers/history` endpoint. gitBusy stores no local growth observations; the browser receives only the additive `starGrowth` value, never stargazer identities.
- **Folders** — never uploaded by choosing them. The Folders workspace reads paths you point it at and shows a local file tree; publishing a folder is a separate explicit action and is not part of this release.
- **Local listening** — the dev server binds to `127.0.0.1` by default, so the dashboard is reachable only on the Mac running it until you opt in to Tailscale.

## Optional Tailscale mobile access

Tailscale access is **off by default**. When you enable it in Settings, gitBusy adds a tailnet-only HTTPS route at `/gitbusy` while leaving the local server on loopback. The Mac shows a pairing code; a phone or tablet must enter it before GitHub-backed API requests are allowed.

Existing unrelated Tailscale Serve routes are preserved. gitBusy reads the current Tailscale Serve state before making any change and never calls `tailscale serve reset`.

### Set up a free Tailscale account

Tailscale's Personal plan is free for personal, non-commercial use. Start at [login.tailscale.com/start](https://login.tailscale.com/start) and sign in with a supported identity provider such as Apple, Google, Microsoft, or GitHub. Tailscale creates your private tailnet during onboarding.

1. Install Tailscale on the Mac from [tailscale.com/download](https://tailscale.com/download), open it, and sign in with the account that owns the tailnet.
2. Install Tailscale on the phone or tablet from the [iOS App Store](https://apps.apple.com/us/app/tailscale/id1470499037) or [Google Play](https://play.google.com/store/apps/details?id=com.tailscale.ipn), then sign in with the same account.
3. Complete the VPN-configuration prompt on each device and confirm both devices appear connected in the Tailscale app or the Machines page.
4. Tailscale Serve requires HTTPS certificates to be enabled for the tailnet. If Tailscale asks for permission during the first gitBusy enablement, approve it, or enable HTTPS certificates in the Tailscale admin console.

### Connect gitBusy from mobile

1. Start gitBusy on the Mac.
2. Open gitBusy **Settings** and choose **Enable Tailscale access**.
3. Copy the displayed HTTPS URL, which ends in `/gitbusy`.
4. Open that URL on the phone or tablet while Tailscale is connected.
5. Enter the pairing code shown in gitBusy Settings on the Mac.
6. Use **Stop mobile access** in Settings, or double-click `gitBusy.app` a second time, to remove the route.

Mobile users can read and browse the dashboard, but notes, favorites, tags, and selected folder files remain device-local. Shared cross-device organization requires a later local SQLite-backed store and is not part of this release.

For Tailscale compatibility, use gitBusy v0.1.10 or newer. Older builds may fail during Serve configuration or invalidate their signature after launch.

Official setup references: [Tailscale pricing](https://tailscale.com/pricing), [Install on macOS](https://tailscale.com/docs/install/mac), [Install on iOS](https://tailscale.com/docs/install/ios), [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve).

## Development

Run from a clone of the source archive:

```
cd gitBusy-source-v0.1.19
npm install
npm run dev
```

The dev server is required because the GitHub bridge is implemented as Vite middleware. Vite prints the localhost URL on start.

### Build, test, and lint

| Command | What it does |
|---|---|
| `npm run dev` | Start the local dev server with the GitHub bridge. |
| `npm test` | Run the server-side test suites (`server/githubAuth.test.ts`, `server/starredLists.test.ts`, `server/exploreRanking.test.ts`, `server/exploreGrowth.test.ts`, `server/exploreStarHistory.test.ts`, `server/githubProxyStarHistory.test.ts`, `server/productionServer.test.ts`, `server/staticFiles.test.ts`, `server/search.test.ts`, `server/gitBusyRebuildWiring.test.ts`) under Node's built-in test runner — 98 tests across 10 files. |
| `npm run build` | Type-check (`tsc -b`) and produce the production Vite build under `dist/`. |
| `npm run lint` | Run `oxlint` over the project. |

### Repository layout

| Path | What it contains |
|---|---|
| `src/` | React front-end, Vite middleware host, and the editor-facing types. |
| `server/` | The GitHub bridge, Explore candidate ranking, official GitHub star-history aggregator, OAuth Device Flow, and the test suites. |
| `macos/` | The AppleScript launcher and the macOS app bundle resources (`Info.plist`, icon). |
| `scripts/` | Bundle toggle, source toggle, and packaging scripts. |
| `release/` | Generated by `scripts/package-gitbusy.zsh` after a successful package command; not present in a source-only archive. `SHA256SUMS.txt` accompanies the artifacts. |
| `vite.config.ts` | Vite config: `base: '/gitbusy/'`, the bridge plugin, and the Tailscale host allow-list. |
| `INSTALL.md` | Companion install guide shipped inside the DMG. |

## Troubleshooting

- **"Sign in with GitHub" says the client is not configured.** You are running a source checkout. Set `GITBUSY_GITHUB_CLIENT_ID='your-public-client-id'` in your shell and restart with `npm run dev`.
- **macOS warns the developer cannot be verified on first launch.** Control-click `gitBusy.app`, choose **Open**, then confirm **Open**. This release is local-signed; see [Release status](#release-status-and-known-limitations).
- **GitHub returns `401 Unauthorized` from every Explore shelf.** The stored OAuth credential has expired or been revoked. In **Settings**, choose **Forget app sign-in** and sign in again with GitHub Device Flow.
- **A list says "snapshot incomplete" and Push changes is disabled.** One of the lists references a repository owned by an organization that has restricted OAuth App access. An organization owner must approve gitBusy at **Organization Settings → Third-party access → OAuth app policy**.
- **A growth shelf says "GitHub history is unavailable right now."** gitBusy could not reach GitHub's `/stargazers/history` endpoint for the evaluated candidate pool. Refresh in a few minutes — the shelf returns to ranked results as soon as the endpoint responds.
- **Tailscale enablement fails with "failed to remove web serve."** The existing Tailscale Serve config is owned by another install or app. gitBusy did not change it; inspect with `tailscale serve status` from your shell and resolve the conflict manually before retrying.
- **The dev server port (`5174`) is already in use.** Stop the previous instance (`Ctrl+C` in its terminal, or double-click `gitBusy.app` a second time) and try again. The dev server is bound strictly to that port.
- **Notes, favorites, or tags do not appear on another browser.** They are device-local in this release. Shared cross-device organization requires a later local SQLite-backed store.
- **Tests fail with `ERR_MODULE_NOT_FOUND` for `server/exploreGrowth.ts`.** The source archive and the repository checkout must be in sync; re-extract `gitBusy-source-v0.1.19.zip` over the checkout and run `npm test` again.

## Support

- Public repository: <https://github.com/ellannjohnson/gitBusy>
- Report a bug: <https://github.com/ellannjohnson/gitBusy/issues/new?title=%5BBug%5D%20>
- Request a feature: <https://github.com/ellannjohnson/gitBusy/issues/new?title=%5BRequest%5D%20>

Use the bug-report link when something does not behave the way this README says it should. Use the feature-request link for new workspace ideas.

## Release status and known limitations

- Current release: **v0.1.19 / build 25** (Apple Silicon arm64). The DMG, ZIP, and source archives under `release/` are produced by the in-tree `scripts/package-gitbusy.zsh` after a successful package run and are SHA-256-summed in `release/SHA256SUMS.txt`; reproducibility inputs are captured in `release/MANIFEST.txt`. A source-only checkout does **not** contain `release/` — that directory is generated, not committed.
- The macOS app is **ad-hoc signed** (`codesign --sign -`) under `GITBUSY_MODE=internal`. It is **not** Developer ID-signed and is **not** Apple-notarized. Gatekeeper will warn on first launch; the control-click **Open** workflow above is the documented workaround. Developer ID signing and notarization remain optional future improvements gated on `GITBUSY_MODE=distribution` in `scripts/package-gitbusy.zsh`.
- The Tailscale pairing path was audited as having limited code entropy and no rate limiting. This release does not address those items; treat tailnet access as suitable for personal, trusted-network use only.
- The predecessor production audit identified distribution and hardening work. The remediation was independently re-verified for this release; the remaining distribution limitation is the absence of Apple Developer ID signing/notarization.
- The dev server is bound to `127.0.0.1` only. Vite's default `allowedHosts` accepts loopback and hostnames that resolve to a loopback interface, which is what `npm run dev` needs. Tailscale remote-development is intentionally out of scope; if it is needed later, gate it behind `GITBUSY_DEV_REMOTE_HOST` and add that single hostname to `allowedHosts`, never a wildcard suffix.
- The GitHub Lists workspace depends on the `user` OAuth scope. Older tokens without that scope will see the **Forget app sign-in** prompt until re-authorized.
- Cross-device sync of notes, tags, and favorites is not part of this release. Browser-local persistence is intentional and device-local.
- Folder publishing is not part of this release. Choosing a folder in the Folders workspace never uploads anything.
- The packaged macOS app and `npm start` use `server/runProductionServer.ts` as the production HTTP server; `npm run dev` runs Vite with the GitHub bridge middleware. Both bind `127.0.0.1` only.

What this release is suitable for today: a public preview for technically capable Mac users who can follow the manual Gatekeeper approval step, plus a personal, single-Mac, local-first workflow that mirrors your starred repos, lets you annotate and organize them, manages GitHub Lists, and optionally extends the same dashboard to a phone or tablet on your own tailnet. It is not suitable for managed, zero-friction installation, multi-tenant hosting, or any environment where Tailscale pairing is exposed to untrusted peers.

## Author and maintainer

EJ is the sole author and maintainer of gitBusy.

## License

gitBusy is released under the GNU General Public License v3.0 (GPLv3-only). See the [`LICENSE`](./LICENSE) file for the full text.

Copyright (c) 2026 EJ.
