import { Check, Tag, X } from 'lucide-react'

type TagStat = { label: string; count: number }

type TagsPanelProps = {
  tags: TagStat[]
  totalRepos: number
  activeTag: string
  onSelect: (tag: string) => void
  onClose: () => void
}

export function TagsPanel({ tags, totalRepos, activeTag, onSelect, onClose }: TagsPanelProps) {
  return (
    <div className="tags-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="tags-panel" role="dialog" aria-modal="true" aria-labelledby="tags-title">
        <div className="tags-panel__header"><div><span className="eyebrow"><Tag size={14} /> Library index</span><h2 id="tags-title">All tags</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close tags"><X size={18} /></button></div>
        <p className="tags-panel__intro">Pick a tag to focus the current collection. Counts reflect the repositories loaded from GitHub.</p>
        <div className="tag-browser">
          <button className={activeTag === 'All tags' ? 'tag-browser__item tag-browser__item--active' : 'tag-browser__item'} type="button" onClick={() => onSelect('All tags')}><span>All tags</span><strong>{totalRepos}</strong></button>
          {tags.map((tag) => <button className={activeTag === tag.label ? 'tag-browser__item tag-browser__item--active' : 'tag-browser__item'} type="button" key={tag.label} onClick={() => onSelect(tag.label)}><span>{activeTag === tag.label && <Check size={13} />}{tag.label}</span><strong>{tag.count}</strong></button>)}
        </div>
        <div className="tags-panel__footer"><span>Tag filters stay local to this browser.</span><button className="button button--quiet button--small" type="button" onClick={onClose}>Done</button></div>
      </section>
    </div>
  )
}
