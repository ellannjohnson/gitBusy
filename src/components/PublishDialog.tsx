import { AlertCircle, Check, FileCode2, Globe2, LockKeyhole, UploadCloud, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { gitignoreTemplates, type GitignoreTemplate } from '../gitignore-templates'
import { publishFolder, type PublishFolderResult } from '../github'
import type { LocalFolder } from './FolderWorkspace'

type PublishDialogProps = {
  folders: LocalFolder[]
  selectedFolderIds: string[]
  onClose: () => void
  onPublished: (result: PublishFolderResult) => void
}

type PreparedFile = {
  path: string
  content: string
  bytes: number
}

type SkippedFile = {
  path: string
  reason: string
}

type PublishState = 'scanning' | 'ready' | 'publishing' | 'success' | 'error'

const MAX_FILE_BYTES = 95 * 1024 * 1024
const binaryExtensions = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.zip', '.tar', '.gz', '.tgz', '.dmg', '.iso',
  '.mp4', '.mov', '.mp3', '.wav', '.woff', '.woff2', '.ttf', '.otf', '.ico', '.class', '.o', '.so',
  '.dylib', '.exe', '.bin',
])

function relativePath(file: File, folder: LocalFolder) {
  const path = file.webkitRelativePath || file.name
  return path.startsWith(`${folder.name}/`) ? path.slice(folder.name.length + 1) : path
}

function normalizedPath(path: string, folder: LocalFolder, multipleFolders: boolean) {
  const relative = relativePath({ name: path, webkitRelativePath: path } as File, folder)
  return (multipleFolders ? `${folder.name}/${relative}` : relative).replaceAll('\\', '/')
}

function isExcluded(path: string) {
  const parts = path.split('/')
  const filename = parts.at(-1) ?? ''
  return parts.includes('node_modules') || parts.includes('.git') || filename === '.DS_Store'
}

function isBinary(path: string) {
  const lower = path.toLowerCase()
  const dot = lower.lastIndexOf('.')
  return dot >= 0 && binaryExtensions.has(lower.slice(dot))
}

function sanitizeRepoName(folderName: string) {
  const safeName = folderName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'folder'
  return `starboard-${safeName}`.slice(0, 100)
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function prepareFiles(selectedFolders: LocalFolder[]) {
  const files: PreparedFile[] = []
  const skipped: SkippedFile[] = []
  const seen = new Set<string>()
  const multipleFolders = selectedFolders.length > 1
  const encoder = new TextEncoder()

  for (const folder of selectedFolders) {
    for (const file of folder.files) {
      const path = normalizedPath(file.webkitRelativePath || file.name, folder, multipleFolders)
      if (isExcluded(path)) {
        skipped.push({ path, reason: 'Ignored repository metadata or dependency folder' })
        continue
      }
      if (isBinary(path)) {
        skipped.push({ path, reason: 'Binary file; gitBusy publishes UTF-8 text only' })
        continue
      }
      if (seen.has(path)) {
        skipped.push({ path, reason: 'Duplicate path across selected folders' })
        continue
      }
      seen.add(path)
      if (file.size > MAX_FILE_BYTES) {
        skipped.push({ path, reason: 'Larger than the 95 MB safety limit' })
        continue
      }
      try {
        const content = await file.text()
        const bytes = encoder.encode(content).byteLength
        if (bytes > MAX_FILE_BYTES) {
          skipped.push({ path, reason: 'UTF-8 content is larger than the 95 MB safety limit' })
          continue
        }
        files.push({ path, content, bytes })
      } catch {
        skipped.push({ path, reason: 'The browser could not read this file' })
      }
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path))
  skipped.sort((a, b) => a.path.localeCompare(b.path))
  return { files, skipped }
}

export function PublishDialog({ folders, selectedFolderIds, onClose, onPublished }: PublishDialogProps) {
  const selectedFolders = useMemo(() => folders.filter((folder) => selectedFolderIds.includes(folder.id)), [folders, selectedFolderIds])
  const defaultRepoName = useMemo(() => sanitizeRepoName(selectedFolders[0]?.name || 'folder'), [selectedFolders])
  const folderKey = useMemo(() => selectedFolders.map((folder) => `${folder.id}:${folder.files.length}`).join('|'), [selectedFolders])
  const [state, setState] = useState<PublishState>('scanning')
  const [preparedKey, setPreparedKey] = useState('')
  const [preparedFiles, setPreparedFiles] = useState<PreparedFile[]>([])
  const [skippedFiles, setSkippedFiles] = useState<SkippedFile[]>([])
  const [scanError, setScanError] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<PublishFolderResult | null>(null)
  const [nameOverride, setNameOverride] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [addGitignore, setAddGitignore] = useState<GitignoreTemplate>('Node')
  const [commitOverride, setCommitOverride] = useState<string | null>(null)

  const name = nameOverride ?? defaultRepoName
  const commitMessage = commitOverride ?? `Add ${name} from Starboard`

  useEffect(() => {
    let cancelled = false
    void prepareFiles(selectedFolders).then(({ files, skipped }) => {
      if (cancelled) return
      setPreparedFiles(files)
      setSkippedFiles(skipped)
      setScanError('')
      setPreparedKey(folderKey)
      setState('ready')
    }).catch(() => {
      if (cancelled) return
      setScanError('The selected files could not be prepared in the browser.')
      setPreparedKey(folderKey)
      setState('error')
    })
    return () => { cancelled = true }
  }, [folderKey, selectedFolders])

  const scanning = state === 'scanning' || preparedKey !== folderKey
  const trimmedName = name.trim()
  const validName = /^[a-zA-Z0-9._-]{1,100}$/.test(trimmedName) && trimmedName !== '..' && trimmedName !== '.git'
  const totalBytes = preparedFiles.reduce((total, file) => total + file.bytes, 0)
  const canPublish = (state === 'ready' || state === 'error') && !scanning && validName && preparedFiles.length > 0

  const handlePublish = async () => {
    if (!canPublish) return
    setState('publishing')
    setError('')
    try {
      const publishResult = await publishFolder({
        name: trimmedName,
        description: description.trim(),
        isPrivate,
        addGitignore,
        commitMessage: commitMessage.trim() || `Add ${trimmedName} from Starboard`,
        files: preparedFiles.map(({ path, content }) => ({ path, content })),
      })
      setResult(publishResult)
      setState('success')
      onPublished(publishResult)
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'GitHub rejected the publish request')
      setState('error')
    }
  }

  return (
    <div className="publish-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="publish-dialog" role="dialog" aria-modal="true" aria-labelledby="publish-dialog-title">
        <header className="publish-dialog__header">
          <div>
            <span className="eyebrow"><UploadCloud size={14} /> gitBusy</span>
            <h2 id="publish-dialog-title">Publish folder to GitHub</h2>
            <p>Prepare a new repository from the selected local folder{selectedFolders.length > 1 ? 's' : ''}. Nothing is published until you press Publish.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close publish dialog"><X size={18} /></button>
        </header>

        {state === 'success' && result ? (
          <div className="publish-success">
            <div className="publish-success__icon"><Check size={22} /></div>
            <span className="section-kicker">Published</span>
            <h3>{result.full_name}</h3>
            <p>{result.filesUploaded} files uploaded{result.filesSkipped.length > 0 ? ` · ${result.filesSkipped.length} skipped` : ''}. GitHub created the repository successfully.</p>
            <div className="publish-dialog__actions">
              <a className="button button--primary" href={result.html_url} target="_blank" rel="noreferrer">Open repository</a>
              <button className="button button--quiet" type="button" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <form className="publish-dialog__body" onSubmit={(event) => { event.preventDefault(); void handlePublish() }}>
            <div className="publish-form-grid">
              <label className="publish-field publish-field--wide"><span>Repository name</span><input value={name} onChange={(event) => setNameOverride(event.target.value)} maxLength={100} aria-invalid={name.length > 0 && !validName} placeholder="my-new-repo" />{name.length > 0 && !validName && <small className="publish-field__error">Use 1–100 letters, numbers, dots, underscores, or hyphens.</small>}</label>
              <label className="publish-field publish-field--wide"><span>Description <em>optional</em></span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What is this folder?" /></label>
              <fieldset className="publish-field publish-field--wide"><legend>Visibility</legend><div className="publish-visibility"><label className={isPrivate ? '' : 'publish-visibility__active'}><input type="radio" name="visibility" checked={!isPrivate} onChange={() => setIsPrivate(false)} /><Globe2 size={15} /><span><strong>Public</strong><small>Anyone can see the repository</small></span></label><label className={isPrivate ? 'publish-visibility__active' : ''}><input type="radio" name="visibility" checked={isPrivate} onChange={() => setIsPrivate(true)} /><LockKeyhole size={15} /><span><strong>Private</strong><small>Only you and collaborators can see it</small></span></label></div></fieldset>
              <label className="publish-field"><span>Gitignore template</span><select value={addGitignore} onChange={(event) => setAddGitignore(event.target.value as GitignoreTemplate)}>{(Object.keys(gitignoreTemplates) as GitignoreTemplate[]).map((template) => <option key={template} value={template}>{template === 'Empty' ? 'Empty' : `${template} starter`}</option>)}</select></label>
              <label className="publish-field"><span>Commit message</span><input value={commitMessage} onChange={(event) => { setCommitOverride(event.target.value) }} /></label>
            </div>

            <div className="publish-file-summary">
              <div className="publish-file-summary__header"><div><span className="section-kicker">Files to publish</span><strong>{scanning ? 'Scanning selected folders…' : `${preparedFiles.length} text files · ${formatBytes(totalBytes)}`}</strong></div><FileCode2 size={17} /></div>
              {scanning && <div className="publish-scan"><span className="loading-bar" /> Reading selected files locally…</div>}
              {scanError && <div className="publish-error"><AlertCircle size={16} />{scanError}</div>}
              {!scanError && !scanning && <>
                <ul className="publish-file-list">{preparedFiles.slice(0, 32).map((file) => <li key={file.path}><span><FileCode2 size={14} />{file.path}</span><small>{formatBytes(file.bytes)}</small></li>)}{preparedFiles.length > 32 && <li className="publish-file-list__more">+ {preparedFiles.length - 32} more files</li>}</ul>
                <div className="publish-file-summary__footer"><span>{skippedFiles.length} skipped</span><span>GitHub credential stays on this Mac</span></div>
                {skippedFiles.length > 0 && <details className="publish-skipped"><summary>Show skipped files</summary><ul>{skippedFiles.slice(0, 20).map((file) => <li key={`${file.path}-${file.reason}`}><strong>{file.path}</strong><span>{file.reason}</span></li>)}</ul></details>}
              </>}
            </div>

            {error && <div className="publish-error" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}
            <div className="publish-dialog__actions"><button className="button button--quiet" type="button" onClick={onClose}>Cancel</button><button className="button button--primary" type="submit" disabled={!canPublish}>{state === 'publishing' ? 'Publishing…' : 'Publish to GitHub'}</button></div>
          </form>
        )}
      </section>
    </div>
  )
}
