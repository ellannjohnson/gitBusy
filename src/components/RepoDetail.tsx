import { ArrowUpRight, BookOpen, Check, FileCode2, Folder, GitFork, GitBranch, LockKeyhole, Save, Star, X } from 'lucide-react'
import { useState } from 'react'
import type { DetailTab, Repo } from '../types'

type RepoDetailProps = {
  repo: Repo
  activeTab: DetailTab
  onTabChange: (tab: DetailTab) => void
  onClose: () => void
  onTogglePinned: () => void
  onSaveNote: (note: string) => void
  loading: boolean
  error: boolean
  source: 'github' | 'demo'
}

const tabs: DetailTab[] = ['Overview', 'Files', 'Notes']

export function RepoDetail({ repo, activeTab, onTabChange, onClose, onTogglePinned, onSaveNote, loading, error, source }: RepoDetailProps) {
  const [noteDraft, setNoteDraft] = useState(repo.note)
  const [saved, setSaved] = useState(false)

  const saveNote = () => {
    onSaveNote(noteDraft)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1800)
  }

  return (
    <aside className="detail-panel" aria-label={`${repo.owner}/${repo.name} preview`}>
      <div className="detail-panel__header">
        <span className="detail-panel__eyebrow"><BookOpen size={14} /> Repo preview</span>
        <button className="icon-button detail-panel__close" type="button" onClick={onClose} aria-label="Close repo preview">
          <X size={18} />
        </button>
      </div>

      <div className="detail-panel__identity">
        <div className="detail-panel__owner"><span className="owner-avatar">{repo.owner.slice(0, 2).toUpperCase()}</span>{repo.owner}</div>
        <div className="detail-panel__title-row">
          <h2>{repo.name}</h2>
          <button className={`detail-star ${repo.isPinned ? 'detail-star--active' : ''}`} type="button" onClick={onTogglePinned} aria-pressed={repo.isPinned} aria-label={repo.isPinned ? 'Remove from favorites' : 'Add to favorites'} title={repo.isPinned ? 'Remove favorite' : 'Add favorite'}>
            <Star size={17} fill={repo.isPinned ? 'currentColor' : 'none'} />
          </button>
        </div>
        <p>{repo.description}</p>
        <div className="detail-panel__links">
          <a className="text-button" href={repo.githubUrl} target="_blank" rel="noreferrer">Open on GitHub <ArrowUpRight size={14} /></a>
          <span className="private-note"><LockKeyhole size={13} /> Notes stay local</span>
        </div>
      </div>

      <div className="detail-tabs" role="tablist" aria-label="Repository detail tabs">
        {tabs.map((tab) => (
          <button className={activeTab === tab ? 'detail-tab detail-tab--active' : 'detail-tab'} key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => onTabChange(tab)}>{tab}</button>
        ))}
      </div>

      <div className="detail-panel__content">
        {activeTab === 'Overview' && (
          <div className="detail-overview">
            <div className="detail-summary">
              <span className="section-kicker">Why it is here</span>
              <p>{repo.summary}</p>
            </div>
            <div className="detail-facts">
              <div><span>Language</span><strong><span className="language__dot" style={{ backgroundColor: repo.languageColor }} />{repo.language}</strong></div>
              <div><span>Project</span><strong>{repo.project}</strong></div>
              <div><span>Last release</span><strong>{repo.lastRelease}</strong></div>
              <div><span>Updated</span><strong>{repo.updated}</strong></div>
              <div><span>Visibility</span><strong>{repo.visibility ?? 'Unknown'}</strong></div>
            </div>
            <div className="detail-readme">
              <div className="detail-block-heading"><span className="section-kicker">README excerpt</span><FileCode2 size={15} /></div>
              {loading ? <div className="detail-loading"><span className="loading-bar" /> Fetching README from GitHub…</div> : error ? <div className="detail-error"><strong>README unavailable</strong><span>GitHub returned no repo detail. The library list is still usable.</span></div> : repo.readme.map((line, index) => index === 0 ? <h3 key={line}>{line.replace('# ', '')}</h3> : <p key={`${line}-${index}`}>{line}</p>)}
            </div>
          </div>
        )}

        {activeTab === 'Files' && (
          <div className="file-browser">
            <div className="file-browser__heading"><span className="section-kicker">Source tree</span><span>{repo.files.length} entries</span></div>
            {loading ? <div className="detail-loading"><span className="loading-bar" /> Fetching source tree from GitHub…</div> : error ? <div className="detail-error"><strong>Source tree unavailable</strong><span>GitHub did not return file metadata for this repo.</span></div> : repo.files.length > 0 ? <ul className="file-list">
              {repo.files.map((file) => {
                const isFolder = !file.includes('.')
                return <li key={file}><span className="file-list__name">{isFolder ? <Folder size={15} /> : <FileCode2 size={15} />}{file}</span><span className="file-list__arrow">›</span></li>
              })}
            </ul> : <p className="detail-empty">No source tree was returned for this repo.</p>}
            <div className="file-browser__footer"><GitBranch size={14} /> default branch · fetched from GitHub</div>
          </div>
        )}

        {activeTab === 'Notes' && (
          <div className="notes-editor">
            <div className="detail-block-heading"><span className="section-kicker">Your note</span><span className="notes-editor__hint">Markdown supported</span></div>
            <label htmlFor="repo-note" className="sr-only">Note for {repo.name}</label>
            <textarea id="repo-note" value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Why did you save this repo?" rows={7} />
            <div className="notes-editor__footer">
              <span className="private-note"><LockKeyhole size={13} /> Stored in this browser</span>
              <button className="button button--small" type="button" onClick={saveNote}>{saved ? <><Check size={14} /> Saved</> : <><Save size={14} /> Save note</>}</button>
            </div>
          </div>
        )}
      </div>

      <div className="detail-panel__footer"><span>{source === 'github' ? 'Synced through local bridge' : 'Demo snapshot'}</span><GitFork size={14} /></div>
    </aside>
  )
}
