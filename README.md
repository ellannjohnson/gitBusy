# Starboard

A local-first GitHub star manager web app inspired by Stargazer’s workflow. Built as an original MVP with a warm editorial dashboard, a live local GitHub bridge, and browser-local persistence.

## Run it

```bash
cd /Users/ellannjohnson/stargazer-local
npm install
npm run dev
```

Then open the localhost URL Vite prints.

## Desktop launcher

A clickable macOS bundle is installed at `~/Desktop/Starboard.app`. Double-click it to start Starboard and open the browser; double-click it again to stop the Starboard server and close matching local tabs when macOS allows browser automation. The canonical bundle lives at `~/Applications/Starboard.app`.

## What works now

- Search repo names, descriptions, summaries, tags, projects, and notes
- Intent-search shortcut for local-first repos
- Live snapshot of your GitHub starred repositories through the local bridge
- Separate **My repos** section for repositories owned by your GitHub account
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

## Checks run

- `npm run build`
- `npm run lint`
- Live localhost preview verified in Hermes Desktop preview
