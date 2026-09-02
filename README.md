# gitBusy

A local-first GitHub star manager web app inspired by Stargazer’s workflow. Built as an original MVP with a warm editorial dashboard, a live local GitHub bridge, and browser-local persistence.

## Run it

```bash
cd /Users/ellannjohnson/stargazer-local
npm install
npm run dev
```

Then open the localhost URL Vite prints.

## Desktop launcher

A clickable macOS bundle is installed at `~/Desktop/gitBusy.app`. The canonical bundle lives at `~/Applications/gitBusy.app`.

### Start and stop behavior

- **First double-click:** starts gitBusy’s local server and opens the browser.
- **Second double-click:** stops gitBusy’s local server, removes gitBusy’s Tailscale route if it is enabled, clears the runtime marker, and closes matching gitBusy browser tabs when macOS allows it.
- The applet exits after dispatching the toggle, so gitBusy may not appear as a running Dock application. Use the same `gitBusy.app` icon a second time to stop the services.
- Closing the browser window or tab does **not** stop the local server. Double-click `gitBusy.app` again.
- For a source install started with `npm run dev`, stop the service in the terminal with `Ctrl+C`.

## What works now

- Search repo names, descriptions, summaries, tags, projects, and notes
- Intent-search shortcut for local-first repos
- Live snapshot of your GitHub starred repositories through the local bridge
- Separate **My repos** section for repositories owned by your GitHub account
- **Folders** section for one or more local folders, with a GitHub-style file tree and read-only file preview
- Live Explore shelves for **Trending**, **Top 20**, **Open source**, and **Self-hosted**
- Explore results show real star counts and mark repos already in your library
- On-demand README, source tree, and latest-release loading per repo
- Filters for all repos, favorites, repos needing review, and archived repos
- Additional filters for subject, project, and activity age
- Language filter and sort by recent, name, or project
- Grid and compact list views
- Repo preview with overview, README excerpt, source tree, and notes tabs
- Favorite/unfavorite repos
- Edit and save repo notes to browser `localStorage`
- Sync button that refreshes the live GitHub snapshot
- `⌘ K` quick-find command palette and `/` search shortcut
- Responsive sidebar and mobile-friendly layout

## Authentication and fallback

The Vite dev server calls `git credential fill` for `github.com`, keeps the credential in memory for the request, and never sends it to the browser. It then calls GitHub’s API for the signed-in user’s stars. If the local credential helper is unavailable, the UI keeps the last local library and explains that it is in demo fallback mode.

The AI organize button runs a private, deterministic subject classifier today: it adds subject tags, groups Inbox repos by subject, and marks stale repos for review. A future local Ollama/LM Studio adapter can replace that classifier without changing the UI or local store.

## Network access

By default, gitBusy listens only on `127.0.0.1`, so GitHub data stays available only on the Mac. In Settings, **Enable Tailscale access** adds a tailnet-only HTTPS route at `/gitbusy` while leaving the local server on loopback. gitBusy reads the current Tailscale Serve state and preserves unrelated routes. The Mac shows a pairing code; a phone or tablet must enter it before GitHub-backed API requests are allowed.

### Set up a free Tailscale account

Tailscale’s Personal plan is free for personal, non-commercial use. Start at [login.tailscale.com/start](https://login.tailscale.com/start) and sign in with a supported identity provider such as Apple, Google, Microsoft, or GitHub. Tailscale creates your private tailnet during onboarding.

1. On the Mac, install Tailscale from [tailscale.com/download](https://tailscale.com/download), open it, and sign in with the account that owns the tailnet.
2. On the phone or tablet, install Tailscale from the [iOS App Store](https://apps.apple.com/us/app/tailscale/id1470499037) or [Google Play](https://play.google.com/store/apps/details?id=com.tailscale.ipn), then sign in with the same account.
3. Complete the VPN-configuration prompt on each device and confirm both devices appear connected in the Tailscale app or Machines page.
4. Tailscale Serve requires HTTPS certificates to be enabled for the tailnet. If Tailscale asks for permission during the first gitBusy enablement, approve it, or enable HTTPS certificates in the Tailscale admin console.

### Connect gitBusy from mobile

1. Start gitBusy on the Mac.
2. Open gitBusy **Settings** and choose **Enable Tailscale access**.
3. Copy the displayed HTTPS URL, which ends in `/gitbusy`.
4. Open that URL on the phone or tablet while Tailscale is connected.
5. Enter the pairing code shown in gitBusy Settings on the Mac.
6. Use **Stop mobile access** in Settings, or double-click the gitBusy app a second time, to remove the route.

Tailscale access is disabled by default. The local browser can keep using gitBusy without pairing. Browser-local notes, favorites, tags, and selected folder files remain device-local; shared cross-device organization requires a later local SQLite-backed store. Use gitBusy `v0.1.3` or newer for the corrected Serve command. Older `v0.1.2` builds can show `must specify filename` on Tailscale enablement.

Official setup references: [Tailscale pricing](https://tailscale.com/pricing), [Install on macOS](https://tailscale.com/docs/install/mac), [Install on iOS](https://tailscale.com/docs/install/ios), and [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve).

## Checks run

- `npm run build`
- `npm run lint`
- Live localhost preview verified in Hermes Desktop preview
