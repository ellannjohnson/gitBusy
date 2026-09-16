import { ArrowUpRight, Bug, CircleHelp, GitBranch, Lightbulb, Scale, Sparkles } from 'lucide-react'
import { APP_BUILD, APP_BUG_REPORT_URL, APP_COPYRIGHT, APP_LICENSE_NAME, APP_LICENSE_NOTICE_URL, APP_NAME, APP_REPOSITORY_URL, APP_REQUEST_URL, APP_VERSION } from '../appMeta'

export function AboutPanel() {
  return (
    <section className="about-panel" aria-labelledby="about-panel-title">
      <div className="about-panel__identity">
        <div className="about-panel__mark" aria-hidden="true"><Sparkles size={28} strokeWidth={1.7} /></div>
        <div>
          <span className="eyebrow">Product</span>
          <h2 id="about-panel-title">{APP_NAME}</h2>
          <p>A local-first GitHub star manager for keeping useful repositories close, searchable, and organized.</p>
        </div>
      </div>

      <dl className="about-panel__meta" aria-label="Application information">
        <div><dt>Version</dt><dd>v{APP_VERSION} · build {APP_BUILD}</dd></div>
        <div><dt>Copyright</dt><dd>{APP_COPYRIGHT}</dd></div>
        <div><dt>Source</dt><dd><a href={APP_REPOSITORY_URL} target="_blank" rel="noreferrer">GitHub repository <ArrowUpRight size={13} /></a></dd></div>
      </dl>

      <section className="about-panel__legal" aria-labelledby="about-legal-title">
        <div className="about-panel__section-heading">
          <span className="eyebrow"><Scale size={14} /> License</span>
          <h3 id="about-legal-title">Legal notice</h3>
          <p>
            gitBusy is free open-source software licensed under {APP_LICENSE_NAME}, copyright {APP_COPYRIGHT}.
            You may copy, modify, and convey it under those terms. It is provided <strong>without any warranty</strong>; see the full license text in the
            {' '}<a href={APP_LICENSE_NOTICE_URL} target="_blank" rel="noreferrer">LICENSE file <ArrowUpRight size={13} /></a>{' '}
            at the project's GitHub repository.
          </p>
        </div>
      </section>

      <section className="about-panel__support" aria-labelledby="about-support-title">
        <div className="about-panel__section-heading">
          <span className="eyebrow"><GitBranch size={14} /> Support</span>
          <h3 id="about-support-title">Help improve gitBusy</h3>
          <p>Use GitHub Issues for feature requests, questions about behavior, and reproducible bugs.</p>
        </div>
        <div className="about-panel__actions">
          <a className="button button--primary" href={APP_BUG_REPORT_URL} target="_blank" rel="noreferrer"><Bug size={15} /> Report a bug <ArrowUpRight size={13} /></a>
          <a className="button button--quiet" href={APP_REQUEST_URL} target="_blank" rel="noreferrer"><Lightbulb size={15} /> Submit a request <ArrowUpRight size={13} /></a>
        </div>
        <div className="about-panel__instructions">
          <h4>When you submit an issue</h4>
          <ul>
            <li>Choose the matching link above and give the issue a short, specific title.</li>
            <li>For a bug, include the steps to reproduce, what you expected, and what happened.</li>
            <li>Include your macOS version and the gitBusy version shown above.</li>
            <li>Share relevant log excerpts only after removing tokens, credentials, and private repository data.</li>
          </ul>
        </div>
      </section>

      <section className="about-panel__faq-link" aria-labelledby="about-faq-title">
        <div>
          <span className="eyebrow"><CircleHelp size={14} /> Help</span>
          <h3 id="about-faq-title">Questions about gitBusy?</h3>
          <p>The FAQ explains the GitHub connection, local data, Explore rankings, Tailscale, Lists, folders, and known limitations.</p>
        </div>
        <a className="button button--quiet" href="#faq">Read the FAQ <ArrowUpRight size={13} /></a>
      </section>
    </section>
  )
}
