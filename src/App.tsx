import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Command,
  Compass,
  FolderKanban,
  Grid2X2,
  List,
  Menu,
  PackageOpen,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react'
import { ExploreShelf } from './components/ExploreShelf'
import { FolderWorkspace, type LocalFolder } from './components/FolderWorkspace'
import { RepoCard } from './components/RepoCard'
import { RepoDetail } from './components/RepoDetail'
import { Sidebar } from './components/Sidebar'
import { TagsPanel } from './components/TagsPanel'
import { seedRepos, sectionMeta } from './data'
import { fetchGithubExplore, fetchGithubRepo, fetchGithubRepos, fetchGithubSnapshot, mapGithubRepo, mergeGithubRepos, subjectsForRepo } from './github'
import type { ExploreKind } from './github'
import type { DetailTab, Filter, Repo, Section } from './types'
import './App.css'

type SortKey = 'updated' | 'name' | 'project'
type ActivityFilter = 'All activity' | 'Updated this week' | 'Updated this month' | 'Stale 90d+'

const filterOptions: Filter[] = ['All', 'Favorites', 'Needs review', 'Archived']
const exploreLinks: Array<{ id: ExploreKind; label: string }> = [
  { id: 'trending', label: 'Trending now' },
  { id: 'top', label: 'Top 20' },
  { id: 'opensource', label: 'Open source' },
  { id: 'selfhosted', label: 'Self-hosted' },
]

function matchesActivity(repo: Repo, filter: ActivityFilter) {
  if (filter === 'All activity') return true
  const ageInDays = repo.updatedAt > 1_000_000_000_000 ? (Date.now() - repo.updatedAt) / 86_400_000 : repo.updatedAt
  if (filter === 'Updated this week') return ageInDays <= 7
  if (filter === 'Updated this month') return ageInDays <= 30
  return ageInDays >= 90
}

function hashRoute() {
  if (typeof window === 'undefined') return { section: 'library' as Section, kind: 'trending' as ExploreKind, repoId: '', menu: false, settings: false, tags: false }
  const [section, kind] = window.location.hash.replace(/^#/, '').split('/')
  const validKinds: ExploreKind[] = ['trending', 'top', 'opensource', 'selfhosted']
  const isMenu = section === 'menu'
  const isSettings = section === 'settings'
  const isTags = section === 'tags'
  const isCollection = section === 'library' || section === 'repos'
  return {
    section: section === 'projects' || section === 'repos' || section === 'folders' || section === 'releases' || section === 'explore' ? section as Section : 'library' as Section,
    kind: validKinds.includes(kind as ExploreKind) ? kind as ExploreKind : 'trending',
    repoId: isCollection ? kind ?? '' : '',
    menu: isMenu,
    settings: isSettings,
    tags: isTags,
  }
}

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
  const [myRepos, setMyRepos] = useState<Repo[]>([])
  const [localFolders, setLocalFolders] = useState<LocalFolder[]>([])
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([])
  const [myReposLoading, setMyReposLoading] = useState(false)
  const [myReposError, setMyReposError] = useState('')
  const [myReposReload, setMyReposReload] = useState(0)
  const [dataSource, setDataSource] = useState<'github' | 'demo'>('demo')
  const [accountLogin, setAccountLogin] = useState('ellannjohnson')
  const [githubError, setGithubError] = useState('')
  const [activeSection, setActiveSection] = useState<Section>(() => hashRoute().section)
  const [filter, setFilter] = useState<Filter>('All')
  const [query, setQuery] = useState('')
  const [language, setLanguage] = useState('All languages')
  const [subjectFilter, setSubjectFilter] = useState('All subjects')
  const [tagFilter, setTagFilter] = useState('All tags')
  const [tagsOpen, setTagsOpen] = useState(() => hashRoute().tags)
  const [projectFilter, setProjectFilter] = useState('All projects')
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('All activity')
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('updated')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedId, setSelectedId] = useState(() => hashRoute().repoId || seedRepos[0].id)
  const [detailTab, setDetailTab] = useState<DetailTab>('Overview')
  const [sidebarOpen, setSidebarOpen] = useState(() => hashRoute().menu)
  const [detailOpen, setDetailOpen] = useState(true)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [organizing, setOrganizing] = useState(false)
  const [syncing, setSyncing] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(false)
  const [exploreKind, setExploreKind] = useState<ExploreKind>(() => hashRoute().kind)
  const [exploreRepos, setExploreRepos] = useState<Repo[]>([])
  const [exploreLoading, setExploreLoading] = useState(false)
  const [exploreError, setExploreError] = useState('')
  const [exploreReload, setExploreReload] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(() => hashRoute().settings)
  const [toast, setToast] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const reposRef = useRef<Repo[]>(repos)
  const myReposLoadedRef = useRef(false)
  const selectedIdRef = useRef(selectedId)

  useEffect(() => {
    window.localStorage.setItem('starboard-repos', JSON.stringify(repos))
  }, [repos])

  useEffect(() => {
    reposRef.current = repos
  }, [repos])

  useEffect(() => {
    let cancelled = false
    const loadGithub = async () => {
      try {
        const snapshot = await fetchGithubSnapshot()
        if (cancelled) return
        setRepos((current) => mergeGithubRepos(snapshot.repos, current))
        setSelectedId((currentId) => {
          const preferred = selectedIdRef.current || currentId
          const nextId = snapshot.repos.some((repo) => String(repo.id) === preferred) ? preferred : String(snapshot.repos[0]?.id ?? preferred)
          selectedIdRef.current = nextId
          return nextId
        })
        setDetailError(false)
        setAccountLogin(snapshot.user.login)
        setDataSource('github')
        setGithubError('')
      } catch (error) {
        if (cancelled) return
        setGithubError(error instanceof Error ? error.message : 'GitHub could not be reached')
      } finally {
        if (!cancelled) setSyncing(false)
      }
    }
    void loadGithub()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (activeSection !== 'repos' || dataSource !== 'github' || myReposLoadedRef.current) return
    let cancelled = false
    const loadMyRepos = async () => {
      setMyReposLoading(true)
      setMyReposError('')
      try {
        const result = await fetchGithubRepos()
        if (cancelled) return
        const currentByName = new Map(reposRef.current.map((repo) => [`${repo.owner}/${repo.name}`, repo]))
        const mapped = result.repos.map((repo) => mapGithubRepo(repo, currentByName.get(`${repo.owner}/${repo.name}`)))
        myReposLoadedRef.current = true
        setMyRepos(mapped)
        setSelectedId((currentId) => {
          const preferred = selectedIdRef.current || currentId
          const nextId = mapped.some((repo) => repo.id === preferred) ? preferred : mapped[0]?.id ?? preferred
          selectedIdRef.current = nextId
          return nextId
        })
      } catch (error) {
        myReposLoadedRef.current = false
        if (!cancelled) setMyReposError(error instanceof Error ? error.message : 'My repos could not be loaded')
      } finally {
        if (!cancelled) setMyReposLoading(false)
      }
    }
    void loadMyRepos()
    return () => { cancelled = true }
  }, [activeSection, dataSource, myReposReload])

  useEffect(() => {
    const handleHashChange = () => {
      const route = hashRoute()
      if (!route.menu && !route.settings && !route.tags) {
        setActiveSection(route.section)
        setExploreKind(route.kind)
      }
      setSidebarOpen(route.menu)
      setSettingsOpen(route.settings)
      setTagsOpen(route.tags)
      if (route.repoId) {
        selectedIdRef.current = route.repoId
        setSelectedId(route.repoId)
        setDetailOpen(true)
        setDetailTab('Overview')
      }
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

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

  const collectionRepos = activeSection === 'repos' ? myRepos : repos
  const pinnedCount = repos.filter((repo) => repo.isPinned).length
  const activeCount = collectionRepos.filter((repo) => repo.status === 'Active').length
  const reviewCount = collectionRepos.filter((repo) => repo.status === 'Needs review').length
  const collectionPinnedCount = collectionRepos.filter((repo) => repo.isPinned).length
  const collectionArchivedCount = collectionRepos.filter((repo) => repo.status === 'Archived').length
  const languages = useMemo(() => ['All languages', ...Array.from(new Set(collectionRepos.map((repo) => repo.language)))], [collectionRepos])
  const subjects = useMemo(() => ['All subjects', ...Array.from(new Set(collectionRepos.flatMap((repo) => subjectsForRepo(repo))))], [collectionRepos])
  const projects = useMemo(() => ['All projects', ...Array.from(new Set(collectionRepos.map((repo) => repo.project)))], [collectionRepos])
  const tagStats = useMemo(() => {
    const counts = new Map<string, number>()
    collectionRepos.forEach((repo) => new Set(repo.tags).forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)))
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => ({ label, count }))
  }, [collectionRepos])
  const selectedRepo = collectionRepos.find((repo) => repo.id === selectedId) ?? (selectedId === seedRepos[0].id ? collectionRepos[0] : undefined)
  const meta = sectionMeta[activeSection]

  useEffect(() => {
    if (dataSource !== 'github' || !selectedRepo || selectedRepo.readme[0] !== 'README not loaded yet') return
    let cancelled = false
    fetchGithubRepo(selectedRepo.owner, selectedRepo.name)
      .then((detail) => {
        if (cancelled) return
        const applyDetail = (current: Repo[]) => current.map((repo) => repo.id === selectedRepo.id ? {
          ...repo,
          ...detail,
          summary: detail.description || repo.summary,
        } : repo)
        setRepos(applyDetail)
        setMyRepos(applyDetail)
      })
      .catch(() => {
        if (!cancelled) {
          setDetailError(true)
          setToast('Repo details could not be loaded')
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => { cancelled = true }
  }, [dataSource, selectedRepo])

  useEffect(() => {
    if (activeSection !== 'explore' || dataSource !== 'github') return
    let cancelled = false
    const loadExplore = async () => {
      setExploreLoading(true)
      setExploreError('')
      try {
        const result = await fetchGithubExplore(exploreKind)
        if (cancelled) return
        const currentByName = new Map(repos.map((repo) => [`${repo.owner}/${repo.name}`, repo]))
        setExploreRepos(result.repos.map((repo) => mapGithubRepo(repo, currentByName.get(`${repo.owner}/${repo.name}`))))
      } catch (error) {
        if (!cancelled) setExploreError(error instanceof Error ? error.message : 'GitHub Explore failed')
      } finally {
        if (!cancelled) setExploreLoading(false)
      }
    }
    void loadExplore()
    return () => { cancelled = true }
  }, [activeSection, dataSource, exploreKind, exploreReload, repos])

  const visibleRepos = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return collectionRepos
      .filter((repo) => {
        if (filter === 'Favorites' && !repo.isPinned) return false
        if (filter === 'Needs review' && repo.status !== 'Needs review') return false
        if (filter === 'Archived' && repo.status !== 'Archived') return false
        if (language !== 'All languages' && repo.language !== language) return false
        if (subjectFilter !== 'All subjects' && !subjectsForRepo(repo).includes(subjectFilter)) return false
        if (tagFilter !== 'All tags' && !repo.tags.includes(tagFilter)) return false
        if (projectFilter !== 'All projects' && repo.project !== projectFilter) return false
        if (!matchesActivity(repo, activityFilter)) return false
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
  }, [activeSection, activityFilter, collectionRepos, filter, language, projectFilter, query, sortKey, subjectFilter, tagFilter])

  const togglePinned = (repoId: string) => {
    const update = (current: Repo[]) => current.map((repo) => repo.id === repoId ? { ...repo, isPinned: !repo.isPinned } : repo)
    setRepos(update)
    setMyRepos(update)
  }

  const saveExploreRepo = (repo: Repo) => {
    setRepos((current) => current.some((item) => item.id === repo.id)
      ? current.map((item) => item.id === repo.id ? { ...item, isPinned: true } : item)
      : [...current, { ...repo, isPinned: true, inLibrary: true, project: 'Inbox' }])
    setExploreRepos((current) => current.map((item) => item.id === repo.id ? { ...item, isPinned: true, inLibrary: true } : item))
    setMyRepos((current) => current.map((item) => item.id === repo.id ? { ...item, isPinned: true, inLibrary: true } : item))
    setToast(`${repo.name} saved to your library`)
  }

  const saveNote = (repoId: string, note: string) => {
    const update = (current: Repo[]) => current.map((repo) => repo.id === repoId ? { ...repo, note } : repo)
    setRepos(update)
    setMyRepos(update)
    setToast('Note saved locally')
  }

  const addLocalFolder = (files: FileList | null) => {
    const selectedFiles = files ? Array.from(files) : []
    if (selectedFiles.length === 0) return
    const firstPath = selectedFiles[0].webkitRelativePath || selectedFiles[0].name
    const name = firstPath.split('/')[0] || 'Selected folder'
    const id = `${name}-${Date.now()}`
    setLocalFolders((current) => [...current, { id, name, files: selectedFiles }])
    setSelectedFolderIds((current) => [...current, id])
    setActiveSection('folders')
    window.history.pushState(null, '', '#folders')
    setToast(`${name} added to local folders`)
  }

  const toggleLocalFolder = (folderId: string, selected: boolean) => {
    setSelectedFolderIds((current) => selected ? Array.from(new Set([...current, folderId])) : current.filter((id) => id !== folderId))
  }

  const removeLocalFolder = (folderId: string) => {
    setLocalFolders((current) => current.filter((folder) => folder.id !== folderId))
    setSelectedFolderIds((current) => current.filter((id) => id !== folderId))
  }

  const handleSync = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      const snapshot = await fetchGithubSnapshot()
      setRepos((current) => mergeGithubRepos(snapshot.repos, current))
      setSelectedId((currentId) => snapshot.repos.some((repo) => String(repo.id) === currentId) ? currentId : String(snapshot.repos[0]?.id ?? currentId))
      myReposLoadedRef.current = false
      setMyReposReload((value) => value + 1)
      setDetailError(false)
      setAccountLogin(snapshot.user.login)
      setDataSource('github')
      setGithubError('')
      setToast(`Loaded ${snapshot.repos.length} stars from GitHub`)
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : 'GitHub could not be reached')
      setToast('GitHub sync failed — keeping the local library')
    } finally {
      setSyncing(false)
    }
  }

  const handleOrganize = () => {
    if (organizing) return
    setOrganizing(true)
    window.setTimeout(() => {
      setRepos((current) => current.map((repo) => {
        const subjects = subjectsForRepo(repo)
        const subjectTags = subjects.filter((subject) => subject !== 'Unsorted').map((subject) => subject.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
        const ageInDays = repo.updatedAt > 1_000_000_000_000 ? (Date.now() - repo.updatedAt) / 86_400_000 : repo.updatedAt
        return {
          ...repo,
          tags: Array.from(new Set([...repo.tags, ...subjectTags])).slice(0, 8),
          project: repo.project === 'Inbox' && subjects[0] !== 'Unsorted' ? subjects[0] : repo.project,
          status: repo.status === 'Archived' ? repo.status : ageInDays >= 90 ? 'Needs review' : repo.status,
        }
      }))
      setOrganizing(false)
      setToast(`Organized ${repos.length} repos by subjects and tags`)
    }, 650)
  }

  const selectRepo = (repoId: string) => {
    selectedIdRef.current = repoId
    setSelectedId(repoId)
    setDetailTab('Overview')
    setDetailOpen(true)
    setDetailError(false)
    setDetailLoading(false)
    const repoHash = activeSection === 'repos' ? `#repos/${repoId}` : `#library/${repoId}`
    if (window.location.hash !== repoHash) window.history.pushState(null, '', repoHash)
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
      selectRepo(repos[0].id)
      setDetailTab('Overview')
    }
  }

  const closeSidebar = () => {
    setSidebarOpen(false)
    if (window.location.hash === '#menu') window.location.hash = activeSection === 'explore' ? `#explore/${exploreKind}` : `#${activeSection}`
  }

  const closeSettings = () => {
    setSettingsOpen(false)
    window.location.hash = activeSection === 'explore' ? `#explore/${exploreKind}` : `#${activeSection}`
  }

  const closeTags = () => {
    setTagsOpen(false)
    if (window.location.hash === '#tags') window.location.hash = '#library'
  }

  const selectTag = (tag: string) => {
    setTagFilter(tag)
    setTagsOpen(false)
    setFiltersOpen(true)
    setActiveSection('library')
    if (window.location.hash === '#tags') window.location.hash = '#library'
  }

  const showTags = tagsOpen || (typeof window !== 'undefined' && window.location.hash === '#tags')
  const showSettings = settingsOpen || (typeof window !== 'undefined' && window.location.hash === '#settings')
  const selectedLabel = selectedRepo?.name ?? 'No selection'

  return (
    <div className="app-shell">
      {sidebarOpen && <button className="sidebar-backdrop" type="button" onClick={closeSidebar} onPointerUp={closeSidebar} aria-label="Close navigation overlay" />}
      <Sidebar activeSection={activeSection} onNavigate={setActiveSection} pinnedCount={pinnedCount} reviewCount={reviewCount} accountLogin={accountLogin} dataSource={dataSource} repos={repos} selectedId={selectedId} onSelectRepo={(repoId) => { selectRepo(repoId); closeSidebar() }} onFilterChange={setFilter} onOpenTags={() => { setTagsOpen(true); setActiveSection('library') }} onSettings={() => { setSettingsOpen(true); closeSidebar() }} sidebarOpen={sidebarOpen} onClose={closeSidebar} />
      <div className="app-content">
        <header className="topbar">
          <a className="icon-button menu-button" href="#menu" onClick={() => setSidebarOpen(true)} onPointerUp={() => setSidebarOpen(true)} aria-label="Open navigation" aria-expanded={sidebarOpen}><Menu size={19} /></a>
          <div className="breadcrumbs"><span>Starboard</span><ChevronRight size={14} /><strong>{meta.title}</strong><span className="breadcrumbs__selection"><ChevronRight size={14} />{selectedLabel}</span></div>
          <div className="topbar__actions">
            <button className="command-button" type="button" onClick={() => setCommandOpen(true)}><Command size={14} /><span>Quick find</span><kbd>⌘ K</kbd></button>
            <button className={`icon-button ${filtersOpen ? 'icon-button--active' : ''}`} type="button" onClick={() => setFiltersOpen((open) => !open)} aria-label="Toggle filters" aria-expanded={filtersOpen} title="Filters"><SlidersHorizontal size={17} /></button>
            <a className="icon-button" href="#settings" onClick={() => setSettingsOpen(true)} aria-label="Open settings" title="Settings"><Settings2 size={17} /></a>
            <span className="topbar__avatar">EJ</span>
          </div>
        </header>

        <main className="main-content" id="library">
          <section className="page-heading">
            <div>
              <span className="eyebrow"><span className="eyebrow__dot" /> {dataSource === 'github' ? `GitHub · ${accountLogin}` : syncing ? 'Connecting to GitHub…' : 'Local demo fallback'}</span>
              <h1>{meta.title}</h1>
              <p>{meta.subtitle}</p>
            </div>
            <div className="page-heading__actions">
              <button className="button button--quiet" type="button" onClick={handleOrganize} disabled={organizing}><Sparkles size={15} /> {organizing ? 'Organizing…' : 'AI organize'} </button>
              <button className="button button--primary" type="button" onClick={handleSync} disabled={syncing}><RefreshCw className={syncing ? 'spin' : ''} size={15} /> {syncing ? 'Syncing…' : 'Sync GitHub'}</button>
            </div>
          </section>

          <section className="stat-strip" aria-label="Library summary">
            <div className="stat"><span className="stat__value">{collectionRepos.length}</span><span className="stat__label">repos in {activeSection === 'repos' ? 'your account' : dataSource === 'github' ? 'GitHub stars' : 'demo data'}</span></div>
            <div className="stat"><span className="stat__value">{activeCount}</span><span className="stat__label">active right now</span></div>
            <div className="stat"><span className="stat__value">{collectionPinnedCount}</span><span className="stat__label">favorites kept close</span></div>
            <div className="stat stat--attention"><span className="stat__value">{reviewCount}</span><span className="stat__label">need a second look</span></div>
          </section>

          {syncing && <div className="context-banner"><RefreshCw className="spin" size={16} /> Reading your GitHub stars through the local credential helper…</div>}
          {!syncing && dataSource === 'github' && <div className="context-banner context-banner--live"><span className="context-banner__live-dot" /> Connected as <strong>{accountLogin}</strong> · {repos.length} starred repos loaded.</div>}
          {!syncing && dataSource === 'demo' && githubError && <div className="context-banner context-banner--warning"><X size={16} /> Showing demo data because GitHub could not be reached: {githubError}</div>}

          {activeSection !== 'explore' && activeSection !== 'folders' && <div className="discovery-strip"><span className="discovery-strip__label">Browse GitHub</span>{exploreLinks.map((link) => <a className="discovery-link" href={`#explore/${link.id}`} key={link.id} onClick={() => { setExploreKind(link.id); setActiveSection('explore') }}>{link.label}<ChevronRight size={14} /></a>)}</div>}

          {activeSection === 'folders' && <div className="context-banner"><FolderIcon /> Select one or more local folders to browse them like repositories. Files stay in your browser.</div>}
          {activeSection === 'repos' && <div className="context-banner"><FolderIcon /> {myReposLoading ? 'Loading repositories you own from GitHub…' : myReposError ? `My repos could not load: ${myReposError}` : `${myRepos.length} repositories owned by ${accountLogin}.`}</div>}
          {filter === 'Needs review' && <div className="context-banner"><Clock3 size={16} /> Needs review is a local queue for repos you or the organizer marked for a second look. Stale 90d+ repos are added here; archived repos stay separate.</div>}
          {activeSection === 'projects' && <div className="context-banner"><FolderIcon /> Showing the <strong>Daily driver</strong> project · change the project model in the local store.</div>}
          {activeSection === 'releases' && <div className="context-banner"><PackageIcon /> Release watchlist · latest release metadata loads when a repo preview is opened.</div>}
          {activeSection === 'explore' && <div className="context-banner"><CompassIcon /> GitHub-wide rankings, not a filtered copy of your library · matches are marked <strong>In library</strong>.</div>}

          {activeSection === 'folders' && <FolderWorkspace folders={localFolders} selectedFolderIds={selectedFolderIds} onAddFolder={addLocalFolder} onToggleFolder={toggleLocalFolder} onRemoveFolder={removeLocalFolder} />}
          {activeSection === 'explore' && <ExploreShelf kind={exploreKind} repos={exploreRepos} loading={exploreLoading} error={dataSource === 'github' ? exploreError : 'GitHub data is still connecting.'} onKindChange={setExploreKind} onSave={saveExploreRepo} onRetry={() => setExploreReload((value) => value + 1)} />}
          {activeSection !== 'explore' && activeSection !== 'folders' && <>
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
              {filterOptions.map((option) => <button className={filter === option ? 'filter-pill filter-pill--active' : 'filter-pill'} type="button" key={option} onClick={() => setFilter(option)}>{option}{option === 'All' && <span>{collectionRepos.length}</span>}{option === 'Favorites' && <span>{collectionPinnedCount}</span>}{option === 'Needs review' && <span>{reviewCount}</span>}{option === 'Archived' && <span>{collectionArchivedCount}</span>}</button>)}
            </div>
            <button className={`filter-toggle ${filtersOpen ? 'filter-toggle--active' : ''}`} type="button" onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen}><SlidersHorizontal size={14} /> More filters <ChevronDown className={filtersOpen ? 'filter-toggle__chevron filter-toggle__chevron--open' : 'filter-toggle__chevron'} size={14} /></button>
            {filtersOpen && <div className="advanced-filters" aria-label="Advanced repo filters">
              <label className="select-label"><span className="advanced-filter__label">Subject</span><select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)}>{subjects.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></label>
              <label className="select-label"><span className="advanced-filter__label">Tag</span><select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option>All tags</option>{tagStats.map((tag) => <option key={tag.label}>{tag.label}</option>)}</select><ChevronDown size={14} /></label>
              <label className="select-label"><span className="advanced-filter__label">Project</span><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>{projects.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></label>
              <label className="select-label"><span className="advanced-filter__label">Activity</span><select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value as ActivityFilter)}><option>All activity</option><option>Updated this week</option><option>Updated this month</option><option>Stale 90d+</option></select><ChevronDown size={14} /></label>
              <button className="clear-advanced" type="button" onClick={() => { setSubjectFilter('All subjects'); setTagFilter('All tags'); setProjectFilter('All projects'); setActivityFilter('All activity') }}>Reset</button>
            </div>}
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
              {activeSection === 'repos' && myReposLoading ? (
                <div className="empty-state"><div className="empty-state__icon"><RefreshCw className="spin" size={21} /></div><h2>Loading your repos</h2><p>Reading repositories owned by {accountLogin} from GitHub.</p></div>
              ) : activeSection === 'repos' && myReposError ? (
                <div className="empty-state"><div className="empty-state__icon"><X size={21} /></div><h2>My repos could not load</h2><p>{myReposError}</p><button className="button button--quiet" type="button" onClick={() => setMyReposReload((value) => value + 1)}>Retry</button></div>
              ) : visibleRepos.length > 0 ? (
                <div className={`repo-grid repo-grid--${viewMode}`}>
                  {visibleRepos.map((repo) => <RepoCard key={repo.id} repo={repo} selected={repo.id === selectedId} viewMode={viewMode} href={activeSection === 'repos' ? `#repos/${repo.id}` : `#library/${repo.id}`} onSelect={() => selectRepo(repo.id)} onTogglePinned={() => togglePinned(repo.id)} />)}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-state__icon"><Search size={21} /></div>
                  <h2>No repos match that view</h2>
                  <p>Try a shorter search, clear a filter, or return to the full library.</p>
                  <button className="button button--quiet" type="button" onClick={() => { setQuery(''); setFilter('All'); setLanguage('All languages'); setSubjectFilter('All subjects'); setTagFilter('All tags'); setProjectFilter('All projects'); setActivityFilter('All activity') }}>Clear filters</button>
                </div>
              )}
            </div>
            {selectedRepo && detailOpen && !(activeSection === 'repos' && (myReposLoading || myReposError || myRepos.length === 0)) && <RepoDetail key={selectedRepo.id} repo={selectedRepo} activeTab={detailTab} onTabChange={setDetailTab} onClose={() => setDetailOpen(false)} onTogglePinned={() => togglePinned(selectedRepo.id)} onSaveNote={(note) => saveNote(selectedRepo.id, note)} loading={detailLoading || (dataSource === 'github' && selectedRepo.readme[0] === 'README not loaded yet' && !detailError)} error={detailError} source={dataSource} />}
          </section>
          </>}
        </main>
      </div>

      {toast && <div className="toast" role="status"><span className="toast__icon"><Check size={14} /></span>{toast}</div>}

      {showTags && <TagsPanel tags={tagStats} totalRepos={collectionRepos.length} activeTag={tagFilter} onSelect={selectTag} onClose={closeTags} />}

      {showSettings && <div className="settings-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSettings() }}>
        <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <div className="settings-panel__header"><div><span className="eyebrow">Workspace</span><h2 id="settings-title">Settings</h2></div><a className="icon-button" href={activeSection === 'explore' ? `#explore/${exploreKind}` : `#${activeSection}`} onClick={closeSettings} onPointerUp={closeSettings} aria-label="Close settings"><X size={18} /></a></div>
          <div className="settings-panel__section"><span className="section-kicker">GitHub connection</span><div className="settings-status"><span className="context-banner__live-dot" /><div><strong>{dataSource === 'github' ? `Connected as ${accountLogin}` : 'Demo fallback'}</strong><p>{dataSource === 'github' ? 'Your starred repositories are loaded through the local bridge.' : githubError || 'No live GitHub snapshot yet.'}</p></div></div><button className="button button--primary button--small" type="button" onClick={handleSync} disabled={syncing}><RefreshCw className={syncing ? 'spin' : ''} size={14} /> {syncing ? 'Refreshing…' : 'Refresh stars'}</button></div>
          <div className="settings-panel__section"><span className="section-kicker">Local data</span><p className="settings-copy">Favorites, notes, and subject organization stay in this browser. GitHub credentials never enter the page.</p><div className="settings-list"><div><span>Stored repos</span><strong>{repos.length}</strong></div><div><span>Saved favorites</span><strong>{pinnedCount}</strong></div><div><span>Subjects available</span><strong>{subjects.length - 1}</strong></div></div></div>
          <div className="settings-panel__footer"><span className="private-note"><Settings2 size={13} /> Starboard local workspace</span><button className="button button--quiet button--small" type="button" onClick={closeSettings}>Done</button></div>
        </section>
      </div>}

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
