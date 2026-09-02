import { Archive, ArrowUpRight, Check, Clock3, GitFork, Globe, LockKeyhole, MoreHorizontal, Star } from 'lucide-react'
import type { Repo } from '../types'

type RepoCardProps = {
  repo: Repo
  selected: boolean
  viewMode: 'grid' | 'list'
  onSelect: () => void
  onTogglePinned: () => void
}

function statusIcon(status: Repo['status']) {
  if (status === 'Archived') return <Archive size={13} />
  if (status === 'Needs review') return <Clock3 size={13} />
  return <span className="status-dot" />
}

function compactNumber(value?: number) {
  if (value === undefined) return ''
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
  return String(value)
}

export function RepoCard({ repo, selected, viewMode, onSelect, onTogglePinned }: RepoCardProps) {
  return (
    <article className={`repo-card repo-card--${viewMode} ${selected ? 'repo-card--selected' : ''}`}>
      <button className="repo-card__body" type="button" onClick={onSelect} aria-label={`Open ${repo.owner}/${repo.name}`}>
        <div className="repo-card__topline">
          <span className="repo-card__source"><GitFork size={14} /> {repo.owner}</span>
          <span className={`repo-status repo-status--${repo.status.toLowerCase().replace(' ', '-')}`}>
            {statusIcon(repo.status)} {repo.status}
          </span>
        </div>
        <div className="repo-card__title-row">
          <h3>{repo.name}</h3>
          <ArrowUpRight className="repo-card__arrow" size={17} />
        </div>
        <p className="repo-card__description">{repo.description}</p>
        <p className="repo-card__summary">{repo.summary}</p>
        <div className="repo-card__meta">
          <span className="language"><span className="language__dot" style={{ backgroundColor: repo.languageColor }} />{repo.language}</span>
          {repo.visibility && <span className="visibility"><>{repo.visibility === 'Private' ? <LockKeyhole size={13} /> : <Globe size={13} />}</>{repo.visibility}</span>}
          {repo.starsCount !== undefined && <span><Star size={13} /> {compactNumber(repo.starsCount)}</span>}
          <span><Clock3 size={13} /> Updated {repo.updated}</span>
          <span className="repo-project">{repo.project}</span>
        </div>
        <div className="tag-row">
          {repo.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
        </div>
      </button>
      <div className="repo-card__actions">
        <button className={`card-action ${repo.isPinned ? 'card-action--active' : ''}`} type="button" onClick={onTogglePinned} aria-pressed={repo.isPinned} aria-label={repo.isPinned ? `Remove ${repo.name} from favorites` : `Add ${repo.name} to favorites`} title={repo.isPinned ? 'Remove favorite' : 'Add favorite'}>
          {repo.isPinned ? <Star size={15} fill="currentColor" /> : <Star size={15} />}
          {repo.isPinned && <span>Favorite</span>}
        </button>
        <button className="card-action" type="button" onClick={onSelect} aria-label={`Select ${repo.name}`} title="Open preview">
          <MoreHorizontal size={16} />
        </button>
        {selected && <span className="selected-mark" aria-label="Selected"><Check size={13} /></span>}
      </div>
    </article>
  )
}
