# Starboard

A local-first GitHub star manager web app inspired by Stargazer’s workflow. Built as an original MVP with a warm editorial dashboard, a live local GitHub bridge, and browser-local persistence.

## Run it

```bash
cd /Users/ellannjohnson/stargazer-local
npm install
npm run dev
```

Then open the localhost URL Vite prints.

## What works now

- Search repo names, descriptions, summaries, tags, projects, and notes
- Intent-search shortcut for local-first repos
- Live snapshot of your GitHub starred repositories through the local bridge
- On-demand README, source tree, and latest-release loading per repo
- Filters for all repos, favorites, repos needing review, and archived repos
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

The AI organize button is intentionally still a safe demo action. A production version can send repo metadata to a local Ollama/LM Studio endpoint and persist summaries/tags in the same local store.

## Checks run

- `npm run build`
- `npm run lint`
- Live localhost preview verified in Hermes Desktop preview
