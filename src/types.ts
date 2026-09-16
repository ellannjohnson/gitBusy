export type RepoStatus = 'Active' | 'Needs review' | 'Archived'

export type Repo = {
  id: string
  owner: string
  name: string
  description: string
  summary: string
  language: string
  languageColor: string
  tags: string[]
  status: RepoStatus
  updated: string
  updatedAt: number
  project: string
  note: string
  isPinned: boolean
  githubUrl: string
  readme: string[]
  files: string[]
  lastRelease: string
  starsCount?: number
  forksCount?: number
  license?: string
  inLibrary?: boolean
  visibility?: 'Public' | 'Private'
  isLocal?: boolean
  localPath?: string
  starGrowth?: number
}

export type Section = 'library' | 'repos' | 'folders' | 'projects' | 'explore' | 'releases' | 'lists' | 'about' | 'faq'
export type Filter = 'All' | 'Favorites' | 'Needs review' | 'Archived'
export type DetailTab = 'Overview' | 'Files' | 'Notes'
