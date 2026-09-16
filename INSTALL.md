# gitBusy installation

## Mac app

Choose the DMG that matches the Mac:

- Apple Silicon (M1, M2, M3, M4, or later): `gitBusy-macos-arm64-v0.1.19.dmg`
- Intel: _Intel/x64 is coming soon — the packaging script supports x64, but an Intel DMG is not included in this release._

Each DMG contains a self-contained `gitBusy.app` with the matching Node runtime and native dependencies. The source ZIP works on either architecture with a local Node/npm installation. The Intel package, when cut, will be an x86_64 build and does not require Rosetta on an Intel Mac.

1. Open the selected DMG.
2. Drag `gitBusy.app` to Applications.
3. If macOS warns that the developer cannot be verified, control-click `gitBusy.app`, choose **Open**, then confirm **Open**. This unsigned build is intended for local testing; notarization requires Apple Developer Program membership.
4. **First double-click:** starts gitBusy’s local server and opens the browser.
5. **Second double-click:** stops gitBusy’s local server, removes gitBusy’s Tailscale route if enabled, clears the runtime marker, and closes matching gitBusy browser tabs when macOS allows it.
6. Closing the browser window or tab does **not** stop the local server. Double-click `gitBusy.app` again to stop the services.

## Packaging modes

`scripts/package-gitbusy.zsh` runs in one of two modes, selected with `GITBUSY_MODE`:

- **`internal`** (the default): ad-hoc local signing (`codesign --sign -`), suitable for personal testing on the operator's own Mac. No Developer ID identity, no notary profile, no archive checksum required.
- **`distribution`**: fail-closed packaging for a notarized public release. Refuses to run unless all three of the following are set non-empty in the environment:
  - `MACOS_CODESIGN_IDENTITY` — a Developer ID Application identity string (`security find-identity -v -p codesigning`).
  - `MACOS_NOTARY_PROFILE` — a `notarytool` keychain profile name (`xcrun notarytool history --keychain-profile <name>`).
  - `GITBUSY_NODE_SHA256` — the SHA-256 of the Node `node-<version>-darwin-<arch>.tar.gz` archive from nodejs.org.

  Under `distribution` mode the script signs with the named Developer ID identity (plus `--options runtime --timestamp`), runs `codesign --display --verbose=4` into `release/codesign.log` for the Stage 6 verifier, and refuses to write any artifact if a prerequisite is missing. The gate fires before signing so a missing prereq cannot produce an ad-hoc artifact under the distribution flag.

Local internal-mode run (the default):

```
GITBUSY_GITHUB_CLIENT_ID='your-public-client-id' \
  zsh scripts/package-gitbusy.zsh 0.1.19 arm64
```

CI run (only when the operator has imported the Developer ID identity, created the notary profile, and recorded all three secrets):

```
GITBUSY_GITHUB_CLIENT_ID='…' \
GITBUSY_MODE=distribution \
MACOS_CODESIGN_IDENTITY='Developer ID Application: Your Name (TEAMID)' \
MACOS_NOTARY_PROFILE='gitbusy-notary' \
GITBUSY_NODE_SHA256='…expected sha256…' \
GITBUSY_BUILD=25 \
  zsh scripts/package-gitbusy.zsh 0.1.19 arm64
```

The script writes `SHA256SUMS.txt` (zip + dmg, deterministic order) and `MANIFEST.txt` (version, build, target/host arch, Node version, Node archive SHA-256, package-lock SHA-256, dependency cache key, bundle identifier, packaging mode, codesign authority, notary profile name) next to the artifacts. None of these contain credentials.

## GitHub authentication

The recommended path is **Sign in with GitHub** in gitBusy Settings. The app opens GitHub’s own verification page and gives you a one-time code. Approve gitBusy there; the local server verifies your account and stores the credential in the Mac’s Keychain. You never type a GitHub password or token into gitBusy, and the credential never reaches the browser or a paired phone. GitHub Lists also require the `user` permission. If gitBusy says the token lacks that scope, choose **Forget app sign-in**, sign in again, and approve the additional permission; GitHub does not add scopes to an existing token.

If GitHub says an organization has OAuth App access restrictions, this is an organization approval—not another personal sign-in. gitBusy will show readable lists when possible but disables **Push changes** while any membership is hidden. An organization owner must approve gitBusy under **Organization Settings → Third-party access → OAuth app policy**. If you are not an owner, request approval from GitHub **Settings → Applications → Authorized OAuth Apps**. See [GitHub’s organization approval guide](https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data/approving-oauth-apps-for-your-organization).

If the browser sign-in button says it is not configured, you are running a source checkout. Start it with the public OAuth client ID supplied for your build:

```bash
GITBUSY_GITHUB_CLIENT_ID='your-public-client-id' npm run dev
```

The public client ID is not a password. Do not put a client secret or GitHub token in this file, the browser, the app URL, or the source archive.

The command-line fallback is also supported. It is useful for technical users or when the OAuth client is not configured:

```bash
brew install gh
gh auth login
gh auth setup-git
gh auth status
```

Choose GitHub.com, HTTPS, **Login with a web browser**, and answer **Yes** when asked to authenticate Git with your GitHub credentials. Return to gitBusy and click **Refresh stars**.

In **GitHub lists**, gitBusy pulls the lists already on your GitHub account. You can create, rename, describe, change privacy, and add/remove starred repositories in local drafts. Nothing changes on GitHub until you press **Push changes**; gitBusy then reads the lists back to verify the result.

In **Explore**, the new **Learning**, **Little-known / high-signal**, **For you**, and **Fastest growing · 7 / 14 / 30 days** shelves are live GitHub rankings. Every shelf returns up to 100 repositories. Learning uses explicit education topics; Little-known is an active 200–10,000-star community-signal heuristic; For you recomputes topic/language matches from your current stars and excludes repos you already star; the three Fastest growing shelves rank the **Learning** candidate pool — repositories with the `learning`, `education`, `developer-education`, or `awesome-list` topic and more than 50 stars (`server/exploreRanking.ts`) — using GitHub's official `GET /repos/{owner}/{repo}/stargazers/history` endpoint (`X-GitHub-Api-Version: 2026-03-10`) and aggregate daily bucket counts into the window — they never enter a "building baseline" state. Adding stars changes the recommendation signals on the next refresh.

## Tailscale mobile access

Tailscale’s Personal plan is free for personal, non-commercial use. Create an account at [login.tailscale.com/start](https://login.tailscale.com/start) using Apple, Google, Microsoft, or GitHub.

1. Install Tailscale on the Mac from [tailscale.com/download](https://tailscale.com/download), open it, and sign in.
2. Install Tailscale on the phone or tablet from the [iOS App Store](https://apps.apple.com/us/app/tailscale/id1470499037) or [Google Play](https://play.google.com/store/apps/details?id=com.tailscale.ipn), then sign in with the same account.
3. Accept the VPN-configuration prompt on both devices and confirm they appear connected in the Tailscale app or Machines page.
4. Tailscale Serve requires HTTPS certificates to be enabled for the tailnet. Approve the prompt if Tailscale asks during setup, or enable HTTPS certificates in the Tailscale admin console.
5. Start gitBusy on the Mac, open **Settings**, and choose **Enable Tailscale access**.
6. Open the displayed HTTPS URL ending in `/gitbusy` on the phone or tablet.
7. Enter the pairing code shown in gitBusy Settings on the Mac.

Tailscale access is off by default. To stop it, choose **Stop mobile access** in Settings or double-click `gitBusy.app` again. Use gitBusy v0.1.10 or newer for compatibility with Tailscale 1.102.3, correct pairing status, the Vite host allowlist, signed-bundle cache handling, the `/gitbusy` mobile path, and GitHub starring from Explore. Older v0.1.2 builds may fail during Serve configuration, and v0.1.3–v0.1.7 builds may fail with a mixed TCP/Web Serve configuration or invalidate their signature after launch. Existing Tailscale routes are preserved.

## Source install

The source package is `gitBusy-source-v0.1.19.zip`. It is for technical users who want to run gitBusy locally.

> **Prerequisite:** gitBusy's `package.json` declares the shared UI package `@tki/amae-ui-system` as a `file:../amae-ui-system` dependency. Before running `npm install`, the `amae-ui-system` package must live as a sibling directory of this checkout (i.e. `../amae-ui-system` from the project root). Without that sibling, `npm install` will fail because the shared package is not on the public npm registry.

```
unzip gitBusy-source-v0.1.19.zip
cd gitBusy-source-v0.1.19
npm install
npm run dev
```

Open the localhost URL printed by Vite. `npm run dev` is the current development server and is required because the GitHub bridge is implemented as Vite middleware; `npm start` runs `server/runProductionServer.ts` for users who want the production HTTP server locally.

## Privacy

GitHub requests are made by the local server. The browser receives repository data, not the GitHub credential. Local organization data is stored in browser storage. No folder is uploaded merely by choosing it in the Folders workspace; publishing a folder is a separate explicit gitBusy action.

## Lifecycle

gitBusy is launched by double-clicking `gitBusy.app` (or running `scripts/gitbusy-toggle.zsh` in development). The launcher does not register a LaunchAgent; the app does not auto-start on login.

We considered adding a per-user LaunchAgent for convenience. We deliberately did not, for three reasons:

1. The OAuth Device Flow requires user interaction for every refresh; a silent restart after logout would re-prompt the user without warning.
2. Auto-restart changes the process ownership model (launchd owns the process; the user does not), which makes "is the app still running?" ambiguous from `ps`.
3. Rollback is simpler: deleting the app removes the runtime; deleting a LaunchAgent first requires `launchctl bootout`.

If login-start is desired in a future release, that change ships as a separately approved lifecycle project, not as a side effect of the security/distribution remediation.

## Why `/gitbusy/`

gitBusy is served from `/gitbusy/` for two reasons: it groups the app under a namespace that survives a future reverse-proxy split, and the macOS launcher can always point a browser tab at `http://127.0.0.1:5174/gitbusy/` regardless of whether anything else is on port 5174. The base path is centralized in `server/basePath.ts`; if a future distribution requires a different path, that constant and the packaging step are the only edit points. We have **not** made it a runtime environment variable because the OAuth Device Flow redirect URL is registered against `/gitbusy/callback` with GitHub and changing it requires a coordinated GitHub app update.

## Supported Node version

gitBusy targets Node 22.x (currently tested against `v22.22.3`). The packaged macOS bundle ships its own Node runtime, so the host's `node --version` does not need to match. For source installs, the `package.json` `engines.node` field pins the supported range; CI uses `--engine-strict` to enforce it.
