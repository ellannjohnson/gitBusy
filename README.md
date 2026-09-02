# Starboard

A local-first GitHub star manager web app inspired by Stargazer’s workflow. Built as an original MVP with a warm editorial dashboard, seeded repo library, and browser-local persistence.

## Run it

```bash
cd /Users/ellannjohnson/stargazer-local
npm install
npm run dev
```

Then open the localhost URL Vite prints.

## What works now

- Search repo names, descriptions, summaries, tags, projects, and notes
- Intent-search demo shortcut for local-first repos
- Filters for all repos, favorites, repos needing review, and archived repos
- Language filter and sort by recent, name, or project
- Grid and compact list views
- Repo preview with overview, README excerpt, source tree, and notes tabs
- Favorite/unfavorite repos
- Edit and save repo notes to browser `localStorage`
- Simulated sync and organize actions with honest status feedback
- `⌘ K` quick-find command palette and `/` search shortcut
- Responsive sidebar and mobile-friendly layout

## Deliberate MVP boundary

The app is fully interactive with seeded demo data, but it does not ask for a GitHub token or call GitHub yet. The next integration seam is the `Repo` model in `src/types.ts` plus the `seedRepos` adapter in `src/data.ts`; replace that adapter with a GitHub API sync layer and keep the UI local-first.

AI organize is also a safe demo action today. A production version can send repo metadata to a local Ollama/LM Studio endpoint and persist summaries/tags in the same local store.

## Checks run

- `npm run build`
- `npm run lint`
- Live localhost preview verified in Hermes Desktop preview
