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

A clickable macOS bundle is installed at `~/Desktop/gitBusy.app`. Double-click it to start gitBusy and open the browser; double-click it again to stop the gitBusy server and close matching local tabs when macOS allows browser automation. The canonical bundle lives at `~/Applications/gitBusy.app`.

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

By default, gitBusy listens only on `127.0.0.1`, so GitHub data stays available only on the Mac. In Settings, **Enable Tailscale access** adds a tailnet-only HTTPS route at `/gitbusy` while leaving the local server on loopback. gitBusy reads the existing Tailscale Serve configuration and preserves unrelated routes. The Mac shows a one-time pairing code; a phone or tablet must enter that code before GitHub-backed API requests are allowed.

The current local browser can continue using gitBusy without pairing. Tailscale access is disabled by default and was not enabled during development. Browser-local notes, favorites, tags, and selected folder files are still device-local; shared cross-device organization will require moving that state into a local SQLite-backed API in a later step.

## Checks run

- `npm run build`
- `npm run lint`
- Live localhost preview verified in Hermes Desktop preview
