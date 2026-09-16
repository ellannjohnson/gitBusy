import { useState } from 'react'
import { ExternalLink, LogIn, LogOut, ShieldCheck } from 'lucide-react'
import type { GithubAuthStatus, GithubDeviceFlow } from '../github'

type GithubConnectionProps = {
  status: GithubAuthStatus | null
  flow: GithubDeviceFlow | null
  busy: boolean
  error: string
  onSignIn: () => void
  onSignOut: () => void
}

type GithubDeviceFlowProps = {
  flow: GithubDeviceFlow
}

export function GithubDeviceFlowCard({ flow }: GithubDeviceFlowProps) {
  const [copied, setCopied] = useState(false)
  const copyDeviceCode = async () => {
    if (!navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(flow.userCode)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="github-auth-card__flow">
      <p><strong>1.</strong> Open GitHub’s verification page.</p>
      <a className="github-auth-card__flow__link" href={flow.verificationUri} target="_blank" rel="noreferrer">Open GitHub <ExternalLink size={13} aria-hidden="true" /></a>
      <p><strong>2.</strong> Enter this exact GitHub one-time code:</p>
      <code className="github-auth-card__code" aria-label="GitHub one-time code">{flow.userCode}</code>
      <button className="button button--quiet button--small" type="button" onClick={() => void copyDeviceCode()}>{copied ? 'Copied' : 'Copy code'}</button>
      <p className="github-auth-card__flow__hint">Approve gitBusy in GitHub, then leave this window open. gitBusy will finish automatically.</p>
    </div>
  )
}

export function GithubConnection({ status, flow, busy, error, onSignIn, onSignOut }: GithubConnectionProps) {
  return (
    <div className="github-auth-card">
      <div className="github-auth-card__header">
        <div>
          <span className="section-kicker">Browser sign-in</span>
          <h3>Connect GitHub without Terminal</h3>
        </div>
        <ShieldCheck size={18} aria-hidden="true" />
      </div>
      <p className="github-auth-card__copy">GitHub handles your sign-in in its own window. gitBusy never sees your GitHub password or sends the access credential to this page.</p>
      {flow ? <GithubDeviceFlowCard flow={flow} /> : status === null ? (
        <p className="github-auth-card__hint">Checking browser sign-in…</p>
      ) : (
        <div className="github-auth-card__actions">
          {status.configured ? <button className="button button--primary button--small" type="button" onClick={onSignIn} disabled={busy}><LogIn size={14} /> {busy ? 'Starting…' : 'Sign in with GitHub'}</button> : <p className="github-auth-card__hint">Browser sign-in is not configured for this build. Use the Terminal fallback below.</p>}
          {status.connected && <button className="button button--quiet button--small" type="button" onClick={onSignOut} disabled={busy}><LogOut size={14} /> Forget app sign-in</button>}
        </div>
      )}
      {(error || status?.error) && <p className="settings-error" role="alert">{error || status?.error}</p>}
      <details className="github-auth-fallback">
        <summary>Use the command line instead</summary>
        <p>Connect your GitHub account from Terminal:</p>
        <ol>
          <li>Run <code>gh auth login</code> and choose GitHub.com, HTTPS, then Login with a web browser.</li>
          <li>Run <code>gh auth setup-git</code>.</li>
          <li>Run <code>gh auth status</code> to confirm the account.</li>
        </ol>
        <p>When <code>gh auth status</code> succeeds, return here and click Refresh stars.</p>
      </details>
    </div>
  )
}
