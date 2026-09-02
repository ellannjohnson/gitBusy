import {
  Archive,
  ArrowUpRight,
  Compass,
  FolderGit2,
  FolderKanban,
  GitFork,
  Library,
  PackageOpen,
  Settings2,
  Sparkles,
  Star,
  Tags,
  X,
} from 'lucide-react'
import type { Filter, Repo, Section } from '../types'

type SidebarProps = {
  activeSection: Section
  onNavigate: (section: Section) => void
  pinnedCount: number
  reviewCount: number
  accountLogin: string
  dataSource: 'github' | 'demo'
  repos: Repo[]
  selectedId: string
  onSelectRepo: (repoId: string) => void
  onFilterChange: (filter: Filter) => void
  onOpenTags: () => void
  onSettings: () => void
  sidebarOpen: boolean
  onClose: () => void
}

const primaryItems: Array<{ id: Section; label: string; icon: typeof Library }> = [
  { id: 'library', label: 'Library', icon: Library },
  { id: 'repos', label: 'My repos', icon: FolderGit2 },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'explore', label: 'Explore', icon: Compass },
  { id: 'releases', label: 'Releases', icon: PackageOpen },
]

export function Sidebar({ activeSection, onNavigate, pinnedCount, reviewCount, accountLogin, dataSource, repos, selectedId, onSelectRepo, onFilterChange, onOpenTags, onSettings, sidebarOpen, onClose }: SidebarProps) {
  return (
    <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`} aria-label="Primary navigation">
      <div className="sidebar__topline">
        <a className="brand" href="#library" onClick={() => onNavigate('library')} aria-label="Starboard library">
          <span className="brand__mark" aria-hidden="true"><Sparkles size={16} strokeWidth={2.4} /></span>
          <span>starboard</span>
        </a>
        <a className="icon-button sidebar__close" href="#library" onClick={onClose} onPointerUp={onClose} aria-label="Close navigation">
          <X size={18} />
        </a>
      </div>

      <div className="sidebar__account">
        <span className="avatar" aria-hidden="true">EJ</span>
        <div>
          <strong>{accountLogin}</strong>
          <span>{dataSource === 'github' ? 'GitHub account' : 'local demo'}</span>
        </div>
        <a className="icon-button sidebar__settings" href="#settings" onClick={onSettings} onPointerUp={onSettings} aria-label="Open settings" title="Settings">
          <Settings2 size={16} />
        </a>
      </div>

      <div className="sidebar__label">Workspace</div>
      <nav className="sidebar__nav">
        {primaryItems.map(({ id, label, icon: Icon }) => (
          <a
            className={`nav-item ${activeSection === id ? 'nav-item--active' : ''}`}
            href={id === 'explore' ? '#explore/trending' : `#${id}`}
            key={id}
            onClick={() => { onNavigate(id); onClose() }}
            aria-current={activeSection === id ? 'page' : undefined}
          >
            <Icon size={17} strokeWidth={1.9} />
            <span>{label}</span>
            {id === 'releases' && <span className="nav-item__dot" aria-label="New releases" />}
          </a>
        ))}
      </nav>

      <div className="sidebar__label sidebar__label--filters">Saved views</div>
      <nav className="sidebar__nav">
        <button className="nav-item" type="button" onClick={() => { onNavigate('library'); onFilterChange('Favorites'); onClose() }}>
          <Star size={17} strokeWidth={1.9} />
          <span>Favorites</span>
          <span className="nav-item__count">{pinnedCount}</span>
        </button>
        <button className="nav-item" type="button" onClick={() => { onNavigate('library'); onFilterChange('Needs review'); onClose() }}>
          <Archive size={17} strokeWidth={1.9} />
          <span>Needs review</span>
          <span className="nav-item__count">{reviewCount}</span>
        </button>
        <a className="nav-item" href="#tags" onClick={() => { onNavigate('library'); onOpenTags(); onClose() }}>
          <Tags size={17} strokeWidth={1.9} />
          <span>All tags</span>
        </a>
      </nav>

      <div className="sidebar__label sidebar__label--repos">Starred repos</div>
      <div className="sidebar__repo-list" aria-label="Starred repositories">
        {repos.slice(0, 8).map((repo) => <button className={repo.id === selectedId ? 'sidebar-repo sidebar-repo--active' : 'sidebar-repo'} type="button" key={repo.id} onPointerDown={() => onSelectRepo(repo.id)} onClick={() => onSelectRepo(repo.id)} title={`${repo.owner}/${repo.name}`}><span className="sidebar-repo__dot" style={{ backgroundColor: repo.languageColor }} /><span className="sidebar-repo__copy"><strong>{repo.name}</strong><small>{repo.owner}</small></span></button>)}
        <button className="sidebar-repo-more" type="button" onClick={() => { onNavigate('library'); onClose() }}>See all {repos.length} repos <ArrowUpRight size={13} /></button>
      </div>

      <div className="sidebar__spacer" />
      <div className="sidebar__footer">
        <div className="sync-indicator"><span className="sync-indicator__dot" /> Saved locally</div>
        <div className="sidebar__footer-row"><span>v0.1 demo</span><GitFork size={14} /></div>
      </div>
    </aside>
  )
}
