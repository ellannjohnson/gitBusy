import { useState } from 'react'
import { Check, Download, Globe2, Lock, Plus, RefreshCw, Search, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { repoFullName, type GithubListDraft } from '../starredLists'
import type { Repo } from '../types'

type GithubListsProps = {
  connected: boolean
  lists: GithubListDraft[]
  repos: Repo[]
  activeListId: string
  loading: boolean
  pushing: boolean
  dirty: boolean
  remotePending: boolean
  blocked: boolean
  error: string
  onOpenSettings: () => void
  onSelect: (localId: string) => void
  onCreate: () => void
  onSuggest: () => void
  onRefresh: () => void
  onDiscard: () => void
  onPush: () => void
  onUpdate: (localId: string, patch: Partial<Pick<GithubListDraft, 'name' | 'description' | 'isPrivate'>>) => void
  onDelete: (localId: string) => void
  onToggleRepo: (localId: string, fullName: string) => void
}

export function StarredLists({
  connected,
  lists,
  repos,
  activeListId,
  loading,
  pushing,
  dirty,
  remotePending,
  blocked,
  error,
  onOpenSettings,
  onSelect,
  onCreate,
  onSuggest,
  onRefresh,
  onDiscard,
  onPush,
  onUpdate,
  onDelete,
  onToggleRepo,
}: GithubListsProps) {
  const activeList = lists.find((list) => list.localId === activeListId) ?? lists[0]
  const needsReauthorization = /required scopes|requires one of the following scopes|requires? (the )?user permission|scope[^;]*\buser\b|\buser\b[^;]*scope/i.test(error)
  const needsOrganizationApproval = /OAuth App access restrictions|restricts OAuth apps/i.test(error)
  const [repoQuery, setRepoQuery] = useState('')
  const visibleRepos = repos
    .filter((repo) => {
      const normalizedQuery = repoQuery.trim().toLowerCase()
      if (!normalizedQuery) return true
      return `${repo.owner}/${repo.name} ${repo.description}`.toLowerCase().includes(normalizedQuery)
    })
    .sort((left, right) => {
      const leftSelected = activeList?.repos.includes(repoFullName(left)) ? 0 : 1
      const rightSelected = activeList?.repos.includes(repoFullName(right)) ? 0 : 1
      if (leftSelected !== rightSelected) return leftSelected - rightSelected
      return repoFullName(left).localeCompare(repoFullName(right))
    })

  if (!connected) {
    return (
      <section className="github-lists" aria-labelledby="github-lists-title">
        <div className="github-lists__heading">
          <div><span className="eyebrow"><Upload size={14} /> GitHub lists</span><h2 id="github-lists-title">Organize your stars on GitHub</h2><p>Sign in to pull your existing GitHub star lists, edit them here, and push reviewed changes back to GitHub.</p></div>
        </div>
        <div className="github-lists__empty empty-state">
          <div className="empty-state__icon"><Lock size={21} /></div>
          <h2>GitHub connection required</h2>
          <p>Lists are account data. gitBusy keeps edits local until you explicitly push them.</p>
          <button className="button button--primary" type="button" onClick={onOpenSettings}>Open connection settings</button>
        </div>
      </section>
    )
  }

  return (
    <section className="github-lists" aria-labelledby="github-lists-title">
      <div className="github-lists__heading">
        <div><span className="eyebrow"><Upload size={14} /> GitHub lists</span><h2 id="github-lists-title">Organize your stars on GitHub</h2><p>Create focused lists, edit membership, and review everything before it leaves gitBusy. Lists are independent of repository topics.</p></div>
        <div className="github-lists__actions">
          <button className="button button--quiet button--small" type="button" onClick={onSuggest} disabled={pushing || loading}><Sparkles size={14} /> Suggest lists</button>
          <button className="button button--quiet button--small" type="button" onClick={onRefresh} disabled={pushing || loading}><Download size={14} /> Pull from GitHub</button>
          <button className="button button--primary button--small" type="button" onClick={onPush} disabled={pushing || loading || !dirty || blocked}><Upload size={14} /> {pushing ? 'Pushing…' : blocked ? 'Push blocked' : dirty ? 'Push changes' : 'Up to date'}</button>
        </div>
      </div>
      <div className="github-lists__meta"><span>{lists.length} {lists.length === 1 ? 'list' : 'lists'} · {repos.length} starred repos available</span><span>{dirty ? 'Draft changes stay on this Mac' : 'Pulled from GitHub'}</span></div>
      {remotePending && <div className="context-banner context-banner--warning"><RefreshCw size={16} /><div><strong>GitHub changed while you were editing</strong><p>Your local draft is preserved. Pull the remote copy only if you want to discard this draft.</p><button className="button button--quiet button--small" type="button" onClick={onDiscard}>Discard draft and pull GitHub</button></div></div>}
      {error && <div className="context-banner context-banner--warning" role="alert"><X size={16} /><div><strong>GitHub lists need attention</strong><p>{error}</p>{needsOrganizationApproval && <><p className="github-lists__reauth-copy">GitHub returned an incomplete list snapshot, so Push changes is disabled to protect memberships that this app cannot see. An organization owner can approve gitBusy under <strong>Settings → Third-party access → OAuth app policy</strong>. If you are not an owner, request approval from your GitHub Authorized OAuth Apps settings.</p><a className="button button--quiet button--small" href="https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data/approving-oauth-apps-for-your-organization" target="_blank" rel="noreferrer">GitHub approval instructions</a></>}{needsReauthorization && <><p className="github-lists__reauth-copy">This token cannot edit GitHub lists yet. Sign out, sign in again, and approve the additional <code>user</code> permission.</p><button className="button button--quiet button--small" type="button" onClick={onOpenSettings}>Reauthorize GitHub</button></>}</div></div>}
      {loading ? (
        <div className="github-lists__empty empty-state"><div className="empty-state__icon"><RefreshCw className="spin" size={21} /></div><h2>Pulling your GitHub lists</h2><p>Reading list names and memberships through the local bridge.</p></div>
      ) : (
        <div className="github-lists__workspace">
          <aside className="github-lists__rail" aria-label="GitHub lists">
            <div className="github-lists__rail-head"><span>Lists</span><strong>{lists.length}</strong></div>
            <div className="github-lists__rail-items">
              {lists.map((list) => <button className={list.localId === activeList?.localId ? 'github-list-nav github-list-nav--active' : 'github-list-nav'} type="button" key={list.localId} onClick={() => onSelect(list.localId)}><span className="github-list-nav__icon">{list.isPrivate ? <Lock size={14} /> : <Globe2 size={14} />}</span><span className="github-list-nav__name">{list.name || 'Untitled list'}</span><span className="github-list-nav__count">{list.repos.length}</span></button>)}
            </div>
            <button className="github-list-add" type="button" onClick={onCreate}><Plus size={15} /> New list</button>
          </aside>
          {activeList ? (
            <div className="github-lists__editor">
              <div className="github-lists__editor-head"><div><span className="section-kicker">{activeList.remoteId ? 'GitHub list' : 'Local draft'}</span><span className="github-lists__sync-state">{dirty ? 'Not pushed' : 'Synced'}</span></div><button className="button button--danger button--small" type="button" onClick={() => onDelete(activeList.localId)} disabled={pushing}><Trash2 size={14} /> Delete locally</button></div>
              <div className="github-list-fields">
                <label><span>Name</span><input value={activeList.name} onChange={(event) => onUpdate(activeList.localId, { name: event.target.value })} maxLength={100} placeholder="e.g. Build next" /></label>
                <label><span>Description</span><textarea value={activeList.description} onChange={(event) => onUpdate(activeList.localId, { description: event.target.value })} maxLength={500} rows={2} placeholder="What belongs in this list?" /></label>
                <label className="github-list-privacy"><input type="checkbox" checked={activeList.isPrivate} onChange={(event) => onUpdate(activeList.localId, { isPrivate: event.target.checked })} /><span><strong>{activeList.isPrivate ? 'Private list' : 'Public list'}</strong><small>{activeList.isPrivate ? 'Only your GitHub account can see it.' : 'Visible on your public GitHub profile.'}</small></span>{activeList.isPrivate ? <Lock size={15} /> : <Globe2 size={15} />}</label>
              </div>
              <div className="github-list-members-head"><div><span className="section-kicker">Membership</span><strong>{activeList.repos.length} repos in this list</strong></div><label className="github-list-search"><Search size={15} /><span className="sr-only">Search starred repos to add</span><input value={repoQuery} onChange={(event) => setRepoQuery(event.target.value)} placeholder="Find a starred repo…" />{repoQuery && <button type="button" onClick={() => setRepoQuery('')} aria-label="Clear repo search"><X size={14} /></button>}</label></div>
              <div className="github-list-members" role="group" aria-label={`Repositories in ${activeList.name || 'this list'}`}>
                {visibleRepos.length > 0 ? visibleRepos.map((repo) => {
                  const fullName = repoFullName(repo)
                  const selected = activeList.repos.includes(fullName)
                  return <label className={selected ? 'github-list-member github-list-member--selected' : 'github-list-member'} key={repo.id}><input type="checkbox" checked={selected} onChange={() => onToggleRepo(activeList.localId, fullName)} /><span className="github-list-member__check">{selected && <Check size={13} />}</span><span className="github-list-member__copy"><strong>{fullName}</strong><small>{repo.description}</small></span><span className="github-list-member__language">{repo.language}</span></label>
                }) : <div className="github-list-members__empty"><Search size={18} /><span>No starred repos match that search.</span></div>}
              </div>
              <p className="github-lists__footnote">Add and remove repos here freely. Nothing changes on GitHub until you choose <strong>Push changes</strong>.</p>
            </div>
          ) : (
            <div className="github-lists__empty empty-state"><div className="empty-state__icon"><Plus size={21} /></div><h2>No lists yet</h2><p>Create a list or ask gitBusy for reviewable category suggestions.</p><button className="button button--primary" type="button" onClick={onCreate}>Create your first list</button></div>
          )}
        </div>
      )}
    </section>
  )
}
