import {
  Archive,
  Compass,
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
import type { Section } from '../types'

type SidebarProps = {
  activeSection: Section
  onNavigate: (section: Section) => void
  pinnedCount: number
  sidebarOpen: boolean
  onClose: () => void
}

const primaryItems: Array<{ id: Section; label: string; icon: typeof Library }> = [
  { id: 'library', label: 'Library', icon: Library },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'explore', label: 'Explore', icon: Compass },
  { id: 'releases', label: 'Releases', icon: PackageOpen },
]

export function Sidebar({ activeSection, onNavigate, pinnedCount, sidebarOpen, onClose }: SidebarProps) {
  return (
    <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`} aria-label="Primary navigation">
      <div className="sidebar__topline">
        <a className="brand" href="#library" onClick={() => onNavigate('library')} aria-label="Starboard library">
          <span className="brand__mark" aria-hidden="true"><Sparkles size={16} strokeWidth={2.4} /></span>
          <span>starboard</span>
        </a>
        <button className="icon-button sidebar__close" type="button" onClick={onClose} aria-label="Close navigation">
          <X size={18} />
        </button>
      </div>

      <div className="sidebar__account">
        <span className="avatar" aria-hidden="true">EJ</span>
        <div>
          <strong>ellannjohnson</strong>
          <span>local library</span>
        </div>
        <button className="icon-button sidebar__settings" type="button" aria-label="Open settings" title="Settings">
          <Settings2 size={16} />
        </button>
      </div>

      <div className="sidebar__label">Workspace</div>
      <nav className="sidebar__nav">
        {primaryItems.map(({ id, label, icon: Icon }) => (
          <button
            className={`nav-item ${activeSection === id ? 'nav-item--active' : ''}`}
            key={id}
            type="button"
            onClick={() => { onNavigate(id); onClose() }}
            aria-current={activeSection === id ? 'page' : undefined}
          >
            <Icon size={17} strokeWidth={1.9} />
            <span>{label}</span>
            {id === 'releases' && <span className="nav-item__dot" aria-label="New releases" />}
          </button>
        ))}
      </nav>

      <div className="sidebar__label sidebar__label--filters">Saved views</div>
      <nav className="sidebar__nav">
        <button className="nav-item" type="button" onClick={() => { onNavigate('library'); onClose() }}>
          <Star size={17} strokeWidth={1.9} />
          <span>Favorites</span>
          <span className="nav-item__count">{pinnedCount}</span>
        </button>
        <button className="nav-item" type="button" onClick={() => { onNavigate('library'); onClose() }}>
          <Archive size={17} strokeWidth={1.9} />
          <span>Needs review</span>
          <span className="nav-item__count">3</span>
        </button>
        <button className="nav-item" type="button" onClick={() => { onNavigate('library'); onClose() }}>
          <Tags size={17} strokeWidth={1.9} />
          <span>All tags</span>
        </button>
      </nav>

      <div className="sidebar__spacer" />
      <div className="sidebar__footer">
        <div className="sync-indicator"><span className="sync-indicator__dot" /> Saved locally</div>
        <div className="sidebar__footer-row"><span>v0.1 demo</span><GitFork size={14} /></div>
      </div>
    </aside>
  )
}
