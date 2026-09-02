import { FileCode2, FileText, Folder, FolderOpen, Plus, Trash2, UploadCloud, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

export type LocalFolder = {
  id: string
  name: string
  files: File[]
}

type FolderWorkspaceProps = {
  folders: LocalFolder[]
  selectedFolderIds: string[]
  onAddFolder: (files: FileList | null) => void
  onToggleFolder: (folderId: string, selected: boolean) => void
  onRemoveFolder: (folderId: string) => void
  onPublish: () => void
}

type TreeEntry = {
  key: string
  path: string
  kind: 'folder' | 'file'
  file?: File
}

function relativePath(file: File, folder: LocalFolder) {
  const path = file.webkitRelativePath || file.name
  return path.startsWith(`${folder.name}/`) ? path.slice(folder.name.length + 1) : path
}

function isReadme(path: string) {
  return path.toLowerCase().split('/').at(-1) === 'readme.md'
}

export function FolderWorkspace({ folders, selectedFolderIds, onAddFolder, onToggleFolder, onRemoveFolder, onPublish }: FolderWorkspaceProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [activeKey, setActiveKey] = useState('')
  const [fileContent, setFileContent] = useState('')
  const [contentKey, setContentKey] = useState('')
  const [fileError, setFileError] = useState('')
  const [fileErrorKey, setFileErrorKey] = useState('')

  useEffect(() => {
    inputRef.current?.setAttribute('webkitdirectory', '')
    inputRef.current?.setAttribute('directory', '')
  }, [])

  const selectedFolders = useMemo(() => folders.filter((folder) => selectedFolderIds.includes(folder.id)), [folders, selectedFolderIds])
  const entries = useMemo(() => {
    const entryMap = new Map<string, TreeEntry>()
    selectedFolders.forEach((folder) => folder.files.forEach((file) => {
      const relative = relativePath(file, folder)
      const displayPath = selectedFolders.length > 1 ? `${folder.name}/${relative}` : relative
      const parts = displayPath.split('/').filter(Boolean)
      parts.slice(0, -1).forEach((_, index) => {
        const path = parts.slice(0, index + 1).join('/')
        entryMap.set(`folder:${path}`, { key: `folder:${path}`, path, kind: 'folder' })
      })
      entryMap.set(`file:${displayPath}`, { key: `file:${displayPath}`, path: displayPath, kind: 'file', file })
    }))
    return Array.from(entryMap.values()).sort((a, b) => a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === 'folder' ? -1 : 1)
  }, [selectedFolders])

  const firstFile = entries.find((entry) => entry.kind === 'file' && isReadme(entry.path)) ?? entries.find((entry) => entry.kind === 'file')
  const activeEntry = entries.find((entry) => entry.key === activeKey) ?? firstFile

  useEffect(() => {
    if (!activeEntry?.file) return
    const entryKey = activeEntry.key
    activeEntry.file.text().then((content) => {
      setFileContent(content)
      setContentKey(entryKey)
    }).catch(() => {
      setFileError('This file could not be read in the browser.')
      setFileErrorKey(entryKey)
    })
    return () => undefined
  }, [activeEntry?.file, activeEntry?.key])

  const addFolder = () => inputRef.current?.click()

  return (
    <section className="folder-workspace" aria-label="Local folder browser">
      <aside className="folder-library">
        <div className="folder-library__header"><div><span className="eyebrow"><FolderOpen size={14} /> Local files</span><h2>Folders</h2></div><div className="folder-library__header-actions"><button className="icon-button" type="button" onClick={addFolder} aria-label="Add local folder" title="Add folder"><Plus size={18} /></button><button className="icon-button" type="button" onClick={onPublish} disabled={selectedFolders.length === 0} aria-label="Publish selected folders to GitHub" title="Publish to GitHub"><UploadCloud size={17} /></button></div></div>
        <p className="folder-library__intro">Choose one or more folders. Nothing is uploaded; the browser reads only what you select.</p>
        <input ref={inputRef} className="sr-only" type="file" multiple onChange={(event) => { onAddFolder(event.target.files); event.currentTarget.value = '' }} aria-label="Choose a local folder" />
        <div className="folder-library__actions"><button className="folder-add-button" type="button" onClick={addFolder}><Plus size={15} /> Add folder</button><button className="button button--quiet folder-publish-button" type="button" onClick={onPublish} disabled={selectedFolders.length === 0}><UploadCloud size={15} /> Publish to GitHub</button></div>
        <div className="folder-choices">
          {folders.map((folder) => <div className={selectedFolderIds.includes(folder.id) ? 'folder-choice folder-choice--selected' : 'folder-choice'} key={folder.id}><label><input type="checkbox" checked={selectedFolderIds.includes(folder.id)} onChange={(event) => onToggleFolder(folder.id, event.target.checked)} /><Folder size={15} /><span><strong>{folder.name}</strong><small>{folder.files.length} files</small></span></label><button className="icon-button folder-choice__remove" type="button" onClick={() => onRemoveFolder(folder.id)} aria-label={`Remove ${folder.name}`} title="Remove folder"><Trash2 size={14} /></button></div>)}
        </div>
        {folders.length === 0 && <div className="folder-empty"><Folder size={22} /><strong>No folders yet</strong><span>Add a project folder to browse its files like a GitHub repository.</span></div>}
        {folders.length > 0 && <div className="folder-library__footer"><span>{selectedFolders.length} selected</span><span>{folders.length} available</span></div>}
      </aside>

      <div className="folder-browser">
        <div className="folder-browser__header"><div className="folder-breadcrumb"><FolderOpen size={15} />{selectedFolders.length ? selectedFolders.map((folder) => <span key={folder.id}>{folder.name}</span>) : <span>Select a folder to start</span>}</div><span className="folder-browser__privacy">Local only</span></div>
        {selectedFolders.length === 0 ? <div className="folder-empty folder-empty--browser"><div className="empty-state__icon"><FolderOpen size={21} /></div><h2>Choose a local folder</h2><p>Pick a folder containing a repository, or select several folders to compare their file trees side by side.</p><button className="button button--primary" type="button" onClick={addFolder}><Plus size={15} /> Choose folder</button></div> : <div className="folder-browser__grid">
          <div className="folder-tree"><div className="folder-tree__heading"><span>Code</span><span>{entries.filter((entry) => entry.kind === 'file').length} files</span></div><ul>{entries.map((entry) => <li key={entry.key}><button className={activeEntry?.key === entry.key ? 'tree-row tree-row--active' : 'tree-row'} type="button" onClick={() => entry.kind === 'file' && setActiveKey(entry.key)}><span className="tree-row__name">{entry.kind === 'folder' ? <Folder size={15} /> : isReadme(entry.path) ? <FileText size={15} /> : <FileCode2 size={15} />}{entry.path}</span>{entry.kind === 'file' && <span className="tree-row__arrow">›</span>}</button></li>)}</ul></div>
          <div className="folder-file-preview"><div className="folder-file-preview__heading"><div><span className="section-kicker">{activeEntry?.path ?? 'README.md'}</span><span className="folder-file-preview__hint">Read-only browser preview</span></div><FileCode2 size={16} /></div>{activeEntry?.file && fileErrorKey === activeEntry.key && fileError ? <div className="folder-preview-empty"><X size={18} /><p>{fileError}</p></div> : <pre>{activeEntry?.file && contentKey === activeEntry.key ? fileContent : 'Select a file from the tree to read it here.'}</pre>}</div>
        </div>}
      </div>
    </section>
  )
}
