import { ArrowUpRight, CircleHelp, ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import { APP_BUG_REPORT_URL, APP_REQUEST_URL } from '../appMeta'

type FaqItem = {
  question: string
  answer: ReactNode
}

const faqSections: Array<{ title: string; items: FaqItem[] }> = [
  {
    title: 'Using gitBusy',
    items: [
      {
        question: 'What is gitBusy?',
        answer: <>gitBusy is a local-first workspace for making a large GitHub star library useful. It keeps the GitHub connection on the device running gitBusy, then gives you search, filters, notes, tags, repository previews, rankings, and local organization tools.</>,
      },
      {
        question: 'How do I connect GitHub?',
        answer: <>Open <strong>Settings → Sign in with GitHub</strong>. gitBusy uses GitHub’s device authorization flow. Your access and refresh tokens stay in the device credential store and are not sent to the browser.</>,
      },
      {
        question: 'Why does a new star sometimes take a moment to appear?',
        answer: <>GitHub’s <code>/user/starred</code> response can lag briefly after a star is added or removed on github.com. Wait a few seconds, then press <strong>Sync GitHub</strong> again. A sync reads the current GitHub snapshot; it does not rely on an old local count.</>,
      },
      {
        question: 'How do I start and stop the desktop app?',
        answer: <>The desktop launcher is a toggle. The first launch starts gitBusy and opens the browser. Launch it again to stop the service. Closing the browser tab alone does not stop the local server.</>,
      },
    ],
  },
  {
    title: 'Library and organization',
    items: [
      {
        question: 'What can I search?',
        answer: <>The library search covers repository names, owners, descriptions, summaries, notes, projects, and tags. <strong>Quick find</strong> also searches repositories as well as commands, so a query such as <code>computer-science</code> can open a matching repository directly.</>,
      },
      {
        question: 'What does AI organize do?',
        answer: <>The current organizer is a private, deterministic classifier. It derives subjects from repository metadata, adds subject tags without deleting existing tags, moves some Inbox items into a subject, and marks stale non-archived repositories as <strong>Needs review</strong>. It does not call an external AI service in the current build.</>,
      },
      {
        question: 'What are tags, subjects, projects, and Needs review?',
        answer: <>Tags are repository labels. Subjects are broader categories derived from metadata. Projects are local groupings. Needs review is a local queue for repositories you or the organizer want to reconsider; it is not a GitHub label and does not change GitHub.</>,
      },
      {
        question: 'Where are my notes and favorites stored?',
        answer: <>Notes, favorites, tags, subjects, and project assignments are stored in the browser’s local workspace. They do not automatically synchronize between your Mac and phone. The GitHub credential is kept separately on the local server and never in browser storage.</>,
      },
    ],
  },
  {
    title: 'GitHub data and Explore',
    items: [
      {
        question: 'What is My repos?',
        answer: <>My repos shows repositories visible to your account, including personal, collaborator, and organization-member access. Each repository displays whether it is Public or Private. It is separate from your starred library.</>,
      },
      {
        question: 'How are Explore rankings made?',
        answer: <>Explore is GitHub-wide. It includes Trending now, Top 100, Learning, Little-known / high-signal, For you, Open source, Self-hosted, and fastest-growing 7/14/30-day shelves. Most shelves use bounded GitHub Search API queries. Trending and Little-known are transparent search-based heuristics, not GitHub’s private website algorithms.</>,
      },
      {
        question: 'How does fastest-growing work?',
        answer: <>The three Fastest growing shelves rank the **Learning** candidate pool — repositories with the <code>learning</code>, <code>education</code>, <code>developer-education</code>, or <code>awesome-list</code> topic and more than 50 stars — using GitHub’s official <code>/repos/{'{owner}'}/{'{repo}'}/stargazers/history</code> endpoint. The result is a ranking inside that filtered set, not a universal official GitHub leaderboard and not a ranking across the Evaluate/Top/Trending/Little-known/For-you candidate pools. Individual stargazer identities are not exposed. If GitHub’s history endpoint is unavailable, gitBusy reports that limitation rather than inventing growth numbers.</>,
      },
      {
        question: 'What does Releases do?',
        answer: <>Releases is currently a watchlist view. Opening a repository preview loads its latest release metadata from GitHub. It is not yet a complete paginated release timeline for every repository.</>,
      },
    ],
  },
  {
    title: 'Lists, folders, mobile, and support',
    items: [
      {
        question: 'Can gitBusy create GitHub Lists?',
        answer: <>Yes. You can create and edit local list drafts, review membership, and explicitly push approved changes to GitHub. Nothing changes on GitHub until you choose Push changes. GitHub Lists require the <code>user</code> OAuth permission, and an organization’s OAuth App restrictions can block list data or mutations.</>,
      },
      {
        question: 'What are Folders?',
        answer: <>Folders let you choose one or more local folders and browse their file trees like repositories. Selected files stay in the browser and are not uploaded automatically. Folder publishing is a separate, explicit action; it never happens just because a folder was selected.</>,
      },
      {
        question: 'Can I use gitBusy from my phone?',
        answer: <>Yes, through optional Tailscale mobile access. The local server stays loopback-only by default. Enable Tailscale in Settings, pair the phone with the displayed code, and open the shown tailnet URL. Browser-local notes, favorites, tags, projects, and selected folders do not automatically follow you to the phone.</>,
      },
      {
        question: 'Where do I report a bug or request a feature?',
        answer: <>Use the links below or the matching links on the About page. Include the gitBusy version, operating system, steps to reproduce, expected behavior, actual behavior, and sanitized logs. Never include tokens, credentials, or private repository data.</>,
      },
    ],
  },
]

export function FaqPanel() {
  return (
    <section className="faq-panel" aria-labelledby="faq-panel-title">
      <header className="faq-panel__intro">
        <div className="faq-panel__mark" aria-hidden="true"><CircleHelp size={28} strokeWidth={1.7} /></div>
        <div>
          <span className="eyebrow">Help</span>
          <h2 id="faq-panel-title">Frequently asked questions</h2>
          <p>How gitBusy connects to GitHub, where local data lives, and what each workspace actually does.</p>
        </div>
      </header>

      <div className="faq-panel__sections">
        {faqSections.map((section) => (
          <section className="faq-section" aria-labelledby={`faq-${section.title}`} key={section.title}>
            <div className="faq-section__heading">
              <span className="eyebrow">Guide</span>
              <h3 id={`faq-${section.title}`}>{section.title}</h3>
            </div>
            <div className="faq-section__items">
              {section.items.map((item) => (
                <details className="faq-item" key={item.question}>
                  <summary>{item.question}</summary>
                  <div className="faq-item__answer">{item.answer}</div>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>

      <footer className="faq-panel__footer">
        <span>Need help with a specific behavior?</span>
        <div>
          <a className="button button--primary button--small" href={APP_BUG_REPORT_URL} target="_blank" rel="noreferrer">Report a bug <ArrowUpRight size={13} /></a>
          <a className="button button--quiet button--small" href={APP_REQUEST_URL} target="_blank" rel="noreferrer">Submit a request <ExternalLink size={13} /></a>
        </div>
      </footer>
    </section>
  )
}
