import { ArrowUpRight, BookOpen, Check, Compass, GitFork, GraduationCap, RefreshCw, Server, Sparkles, Star, TrendingUp } from 'lucide-react'
import type { ExploreKind, ExplorePreferenceSignal } from '../github'
import { isGrowthShelf } from '../github'
import type { Repo } from '../types'

type ExploreShelfProps = {
  kind: ExploreKind
  repos: Repo[]
  preferenceSignals: ExplorePreferenceSignal[]
  loading: boolean
  error: string
  onKindChange: (kind: ExploreKind) => void
  onSave: (repo: Repo) => void | Promise<void>
  savingId?: string
  onRetry: () => void
}

type Shelf = { id: ExploreKind; label: string; note: string; icon: typeof Sparkles }

const shelves: Shelf[] = [
  { id: 'trending', label: 'Trending now', note: 'High-star repos pushed in the last 30 days.', icon: Sparkles },
  { id: 'top', label: 'Top 100', note: 'Up to 100 of the most-starred public repos returned by GitHub.', icon: Star },
  { id: 'learning', label: 'Learning', note: 'Learning, education, developer-education, and curated reference repos.', icon: GraduationCap },
  { id: 'littleknown', label: 'Little-known / high-signal', note: 'Active repos in a smaller star band, ranked by community signals—not an objective quality score.', icon: Compass },
  { id: 'personalized', label: 'For you', note: 'Little-known matches to topics and languages in your current starred repos; refreshes as your stars change.', icon: Sparkles },
  { id: 'growth-7', label: 'Fastest growing · 7 days', note: 'Showing fastest star growth in the last 7 days among the Learning candidate pool (learning, education, developer-education, or awesome-list topics with >50 stars), sourced from GitHub\'s /stargazers/history endpoint.', icon: TrendingUp },
  { id: 'growth-14', label: 'Fastest growing · 14 days', note: 'Showing fastest star growth in the last 14 days among the Learning candidate pool (learning, education, developer-education, or awesome-list topics with >50 stars), sourced from GitHub\'s /stargazers/history endpoint.', icon: TrendingUp },
  { id: 'growth-30', label: 'Fastest growing · 30 days', note: 'Showing fastest star growth in the last 30 days among the Learning candidate pool (learning, education, developer-education, or awesome-list topics with >50 stars), sourced from GitHub\'s /stargazers/history endpoint.', icon: TrendingUp },
  { id: 'opensource', label: 'Open source', note: 'Popular repos with MIT, Apache-2.0, or BSD-3-Clause licenses.', icon: BookOpen },
  { id: 'selfhosted', label: 'Self-hosted', note: 'Popular repos carrying the self-hosted topic.', icon: Server },
]

function compactNumber(value?: number) {
  if (value === undefined) return '—'
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
  return String(value)
}

function compactDelta(value?: number) {
  if (value === undefined) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${compactNumber(value)}`
}

export function ExploreShelf({ kind, repos, preferenceSignals, loading, error, onKindChange, onSave, savingId, onRetry }: ExploreShelfProps) {
  const shelf = shelves.find((item) => item.id === kind) ?? shelves[0]
  const Icon = shelf.icon
  const visibleSignals = preferenceSignals.slice(0, 5).map((signal) => `${signal.kind}:${signal.value} (${signal.count})`).join(' · ')
  const isGrowth = isGrowthShelf(kind)

  return (
    <section className="explore-shelf" aria-label="Explore GitHub repositories">
      <div className="explore-shelf__heading">
        <div>
          <span className="eyebrow"><Icon size={14} /> GitHub Explore</span>
          <h2>{shelf.label}</h2>
          <p>{shelf.note}</p>
          {kind === 'personalized' && <p className="explore-shelf__signals">{visibleSignals ? `Current star signals: ${visibleSignals}` : 'No repeated star signals yet; showing a broad little-known set.'}</p>}
        </div>
        <span className="explore-shelf__source"><span className="context-banner__live-dot" /> {repos.length > 0 ? `${repos.length} results` : 'Live GitHub results'}</span>
      </div>

      <div className="explore-tabs" role="tablist" aria-label="Explore categories">
        {shelves.map((item) => <a className={item.id === kind ? 'explore-tab explore-tab--active' : 'explore-tab'} key={item.id} href={`#explore/${item.id}`} role="tab" aria-selected={item.id === kind} onClick={() => onKindChange(item.id)}>{item.label}</a>)}
      </div>

      {loading && <div className="explore-loading" role="status"><RefreshCw className="spin" size={16} /> Loading live rankings…</div>}
      {!loading && error && <div className="explore-error"><strong>GitHub Explore could not load.</strong><span>{error}</span><button className="button button--quiet button--small" type="button" onClick={onRetry}>Try again</button></div>}
      {!loading && !error && repos.length === 0 && !isGrowth && <div className="explore-error"><strong>No repos returned for this shelf.</strong><span>GitHub may be rate-limiting the search or the category has no matches.</span><button className="button button--quiet button--small" type="button" onClick={onRetry}>Refresh</button></div>}
      {!loading && !error && repos.length === 0 && isGrowth && <div className="explore-error"><strong>GitHub history is unavailable right now.</strong><span>gitBusy could not reach GitHub's /stargazers/history endpoint for the evaluated candidate pool this refresh. Try again in a few minutes — when the endpoint responds, the shelf returns to ranked results immediately.</span><button className="button button--quiet button--small" type="button" onClick={onRetry}>Try again</button></div>}
      {!loading && !error && repos.length > 0 && (
        <ol className="explore-list">
          {repos.map((repo, index) => (
            <li className="explore-card" key={`${kind}-${repo.id}`}>
              <span className="explore-card__rank">{String(index + 1).padStart(2, '0')}</span>
              <div className="explore-card__main">
                <div className="explore-card__topline"><span className="repo-card__source"><GitFork size={14} /> {repo.owner}/{repo.name}</span>{isGrowth && repo.starGrowth !== undefined ? <span className="explore-stars"><TrendingUp size={14} /> {compactDelta(repo.starGrowth)} stars</span> : <span className="explore-stars"><Star size={14} fill="currentColor" /> {compactNumber(repo.starsCount)}</span>}</div>
                <h3>{repo.name}</h3>
                <p>{repo.description}</p>
                <div className="tag-row">{repo.tags.slice(0, 4).map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div>
                <div className="explore-card__footer"><span className="language"><span className="language__dot" style={{ backgroundColor: repo.languageColor }} />{repo.language}</span><span>{repo.license ?? 'License not listed'}</span><div className="explore-card__actions"><a className="text-link" href={repo.githubUrl} target="_blank" rel="noreferrer">Open <ArrowUpRight size={13} /></a><button className={`save-repo ${repo.inLibrary ? 'save-repo--saved' : ''}`} type="button" onClick={() => onSave(repo)} disabled={savingId === repo.id} aria-busy={savingId === repo.id}>{savingId === repo.id ? 'Adding…' : repo.isPinned ? <><Check size={13} /> Favorite</> : repo.inLibrary ? <><Check size={13} /> In library</> : 'Add to library'}</button></div></div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
