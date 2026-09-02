import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Command,
  Compass,
  FolderKanban,
  Grid2X2,
  List,
  Menu,
  PackageOpen,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react'
import { RepoCard } from './components/RepoCard'
import { RepoDetail } from './components/RepoDetail'
import { Sidebar } from './components/Sidebar'
import { seedRepos, sectionMeta } from './data'
import type { DetailTab, Filter, Repo, Section } from './types'
import './App.css'

type SortKey = 'updated' | 'name' | 'project'

const filterOptions: Filter[] = ['All', 'Favorites', 'Needs review', 'Archived']

function loadRepos() {
  if (typeof window === 'undefined') return seedRepos
  try {
    const saved = window.localStorage.getItem('starboard-repos')
    return saved ? JSON.parse(saved) as Repo[] : seedRepos
  } catch {
    return seedRepos
  }
}

function App() {
  const [repos, setRepos] = useState<Repo[]>(loadRepos)
  const [activeSection, setActiveSection] = useState<Section>('library')
  const [filter, setFilter] = useState<Filter>('All')
  const [query, setQuery] = useState('')
  const [language, setLanguage] = useState('All languages')
  const [sortKey, setSortKey] = useState<SortKey>('updated')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedId, setSelectedId] = useState(seedRepos[0].id)
  const [detailTab, setDetailTab] = useState<DetailTab>('Overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(true)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [organizing, setOrganizing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [toast, setToast] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.localStorage.setItem('starboard-repos', JSON.stringify(repos))
  }, [repos])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
      }
      if (event.key === '/' && !isTyping) {
        event.preventDefault()
        searchRef.current?.focus()
      }
      if (event.key === 'Escape') {
        setCommandOpen(false)
        setSidebarOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 2400)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const pinnedCount = repos.filter((repo) => repo.isPinned).length
  const activeCount = repos.filter((repo) => repo.status === 'Active').length
  const reviewCount = repos.filter((repo) => repo.status === 'Needs review').length
  const languages = useMemo(() => ['All languages', ...Array.from(new Set(repos.map((repo) => repo.language)))], [repos])
  const selectedRepo = repos.find((repo) => repo.id === selectedId) ?? repos[0]
  const meta = sectionMeta[activeSection]

  const visibleRepos = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return repos
      .filter((repo) => {
        if (filter === 'Favorites' && !repo.isPinned) return false
        if (filter === 'Needs review' && repo.status !== 'Needs review') return false
        if (filter === 'Archived' && repo.status !== 'Archived') return false
        if (language !== 'All languages' && repo.language !== language) return false
        if (activeSection === 'projects' && repo.project !== 'Daily driver') return false
        if (activeSection === 'releases' && repo.lastRelease === 'No releases') return false
        if (normalizedQuery) {
          const haystack = [repo.owner, repo.name, repo.description, repo.summary, repo.note, repo.project, ...repo.tags].join(' ').toLowerCase()
          if (!haystack.includes(normalizedQuery)) return false
        }
        return true
      })
      .sort((a, b) => {
        if (sortKey === 'name') return `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`)
        if (sortKey === 'project') return a.project.localeCompare(b.project)
        return a.updatedAt - b.updatedAt
      })
  }, [activeSection, filter, language, query, repos, sortKey])

  const togglePinned = (repoId: string) => {
    setRepos((current) => current.map((repo) => repo.id === repoId ? { ...repo, isPinned: !repo.isPinned } : repo))
  }

  const saveNote = (repoId: string, note: string) => {
    setRepos((current) => current.map((repo) => repo.id === repoId ? { ...repo, note } : repo))
    setToast('Note saved locally')
  }

  const handleSync = () => {
    if (syncing) return
    setSyncing(true)
    window.setTimeout(() => {
      setSyncing(false)
      setToast('GitHub snapshot is up to date')
    }, 1000)
  }

  const handleOrganize = () => {
    if (organizing) return
    setOrganizing(true)
    window.setTimeout(() => {
      setOrganizing(false)
      setToast('Library scan complete — nothing changed')
    }, 900)
  }

  const runCommand = (command: string) => {
    if (command === 'search') {
      setCommandOpen(false)
      searchRef.current?.focus()
    }
    if (command === 'sync') {
      setCommandOpen(false)
      handleSync()
    }
    if (command === 'review') {
      setCommandOpen(false)
      setFilter('Needs review')
      setActiveSection('library')
    }
    if (command === 'first') {
      setCommandOpen(false)
      setSelectedId(repos[0].id)
      setDetailOpen(true)
      setDetailTab('Overview')
    }
  }

  if (!selectedRepo) return null

  return (
    <div className="app-shell">
      <Sidebar activeSection={activeSection} onNavigate={setActiveSection} pinnedCount={pinnedCount} sidebarOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="app-content">
        <header className="topbar">
          <button className="icon-button menu-button" type="button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
          <div className="breadcrumbs"><span>Starboard</span><ChevronRight size={14} /><strong>{meta.title}</strong></div>
          <div className="topbar__actions">
            <button className="command-button" type="button" onClick={() => setCommandOpen(true)}><Command size={14} /><span>Quick find</span><kbd>⌘ K</kbd></button>
            <button className="icon-button" type="button" aria-label="Filters" title="Filters"><SlidersHorizontal size={17} /></button>
            <span className="topbar__avatar">EJ</span>
          </div>
        </header>

        <main className="main-content" id="library">
          <section className="page-heading">
            <div>
              <span className="eyebrow"><span className="eyebrow__dot" /> Local workspace</span>
              <h1>{meta.title}</h1>
              <p>{meta.subtitle}</p>
            </div>
            <div className="page-heading__actions">
              <button className="button button--quiet" type="button" onClick={handleOrganize} disabled={organizing}><Sparkles size={15} /> {organizing ? 'Organizing…' : 'AI organize'} </button>
              <button className="button button--primary" type="button" onClick={handleSync} disabled={syncing}><RefreshCw className={syncing ? 'spin' : ''} size={15} /> {syncing ? 'Syncing…' : 'Sync GitHub'}</button>
            </div>
          </section>

          <section className="stat-strip" aria-label="Library summary">
            <div className="stat"><span className="stat__value">{repos.length}</span><span className="stat__label">repos in demo library</span></div>
            <div className="stat"><span className="stat__value">{activeCount}</span><span className="stat__label">active right now</span></div>
            <div className="stat"><span className="stat__value">{pinnedCount}</span><span className="stat__label">favorites kept close</span></div>
            <div className="stat stat--attention"><span className="stat__value">{reviewCount}</span><span className="stat__label">need a second look</span></div>
          </section>

          {activeSection === 'projects' && <div className="context-banner"><FolderIcon /> Showing the <strong>Daily driver</strong> project · change the project model when GitHub sync is connected.</div>}
          {activeSection === 'releases' && <div className="context-banner"><PackageIcon /> Showing repos with a release in the imported snapshot.</div>}
          {activeSection === 'explore' && <div className="context-banner"><CompassIcon /> Explore is seeded with your active repos so the habit stays close to your library.</div>}

          <section className="library-toolbar" aria-label="Library controls">
            <form className="search-box" onSubmit={(event) => event.preventDefault()}>
              <Search size={18} aria-hidden="true" />
              <label className="sr-only" htmlFor="library-search">Search your library</label>
              <input ref={searchRef} id="library-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names, tags, notes…" />
              {query ? <button className="search-box__clear" type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={15} /></button> : <kbd>/</kbd>}
            </form>
            <button className={`intent-button ${query === 'local-first' ? 'intent-button--active' : ''}`} type="button" onClick={() => setQuery('local-first')}><Sparkles size={14} /> Try intent search</button>
            <div className="toolbar-divider" />
            <div className="filter-pills" role="group" aria-label="Filter repos">
              {filterOptions.map((option) => <button className={filter === option ? 'filter-pill filter-pill--active' : 'filter-pill'} type="button" key={option} onClick={() => setFilter(option)}>{option}{option === 'All' && <span>{repos.length}</span>}{option === 'Favorites' && <span>{pinnedCount}</span>}{option === 'Needs review' && <span>{reviewCount}</span>}{option === 'Archived' && <span>{repos.filter((repo) => repo.status === 'Archived').length}</span>}</button>)}
            </div>
          </section>

          <section className="workspace" aria-label="Repository library">
            <div className="collection-panel">
              <div className="collection-header">
                <div><span className="section-kicker">{visibleRepos.length} in view</span><span className="collection-header__hint">{query ? `Matching “${query}”` : 'Sorted by recently updated'}</span></div>
                <div className="collection-controls">
                  <label className="select-label" htmlFor="language-select"><span className="sr-only">Filter by language</span><select id="language-select" value={language} onChange={(event) => setLanguage(event.target.value)}>{languages.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></label>
                  <label className="select-label" htmlFor="sort-select"><span className="sr-only">Sort repositories</span><select id="sort-select" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}><option value="updated">Recent</option><option value="name">Name</option><option value="project">Project</option></select><ChevronDown size={14} /></label>
                  <div className="view-switcher" role="group" aria-label="View mode"><button className={viewMode === 'grid' ? 'view-button view-button--active' : 'view-button'} type="button" onClick={() => setViewMode('grid')} aria-label="Grid view" aria-pressed={viewMode === 'grid'}><Grid2X2 size={15} /></button><button className={viewMode === 'list' ? 'view-button view-button--active' : 'view-button'} type="button" onClick={() => setViewMode('list')} aria-label="List view" aria-pressed={viewMode === 'list'}><List size={16} /></button></div>
                </div>
              </div>
              {visibleRepos.length > 0 ? (
                <div className={`repo-grid repo-grid--${viewMode}`}>
                  {visibleRepos.map((repo) => <RepoCard key={repo.id} repo={repo} selected={repo.id === selectedId} viewMode={viewMode} onSelect={() => { setSelectedId(repo.id); setDetailTab('Overview'); setDetailOpen(true) }} onTogglePinned={() => togglePinned(repo.id)} />)}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-state__icon"><Search size={21} /></div>
                  <h2>No repos match that view</h2>
                  <p>Try a shorter search, clear a filter, or return to the full library.</p>
                  <button className="button button--quiet" type="button" onClick={() => { setQuery(''); setFilter('All'); setLanguage('All languages') }}>Clear filters</button>
                </div>
              )}
            </div>
            {detailOpen && <RepoDetail key={selectedRepo.id} repo={selectedRepo} activeTab={detailTab} onTabChange={setDetailTab} onClose={() => setDetailOpen(false)} onTogglePinned={() => togglePinned(selectedRepo.id)} onSaveNote={(note) => saveNote(selectedRepo.id, note)} />}
          </section>
        </main>
      </div>

      {toast && <div className="toast" role="status"><span className="toast__icon"><Check size={14} /></span>{toast}</div>}

      {commandOpen && (
        <div className="command-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCommandOpen(false) }}>
          <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-title">
            <div className="command-palette__topline"><span id="command-title">Quick find</span><button className="icon-button" type="button" onClick={() => setCommandOpen(false)} aria-label="Close quick find"><X size={17} /></button></div>
            <label className="command-search"><Search size={17} /><span className="sr-only">Search commands</span><input autoFocus value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} placeholder="What do you want to do?" /></label>
            <div className="command-list">
              {[
                { id: 'search', label: 'Search the library', hint: '/', icon: Search },
                { id: 'sync', label: 'Sync GitHub snapshot', hint: '⌘ S', icon: RefreshCw },
                { id: 'review', label: 'Show repos needing review', hint: '3 repos', icon: SlidersHorizontal },
                { id: 'first', label: 'Open the first repo', hint: '↵', icon: ChevronRight },
              ].filter((item) => item.label.toLowerCase().includes(commandQuery.toLowerCase())).map(({ id, label, hint, icon: Icon }) => <button className="command-item" type="button" key={id} onClick={() => runCommand(id)}><Icon size={16} /><span>{label}</span><kbd>{hint}</kbd></button>)}
              {commandQuery && !['search', 'sync', 'review', 'first'].some((id) => id.includes(commandQuery.toLowerCase())) && <div className="command-empty">No commands match “{commandQuery}”.</div>}
            </div>
            <div className="command-palette__footer"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>esc</kbd> close</span></div>
          </section>
        </div>
      )}
    </div>
  )
}

function FolderIcon() { return <FolderKanban size={16} aria-hidden="true" /> }
function PackageIcon() { return <PackageOpen size={16} aria-hidden="true" /> }
function CompassIcon() { return <Compass size={16} aria-hidden="true" /> }

export default App
