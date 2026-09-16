// REST upstream error sanitization — APPSEC-007 / DC-010.
// Maps a non-2xx GitHub REST status code + the raw upstream message
// into a stable user-facing string. The original upstream message is
// captured server-side (see server/audit.ts, DC-001) and NEVER
// returned to the client. The mapping is intentionally coarse-grained
// at the level "auth / denied / missing / rejected / upstream /
// network"; the goal is to keep operator-facing debug detail out of
// the wire response without inventing per-upstream error codes.

export type RestErrorSummary = { status: number; message: string }

export function summarizeRestGithubError(status: number, _upstreamMessage: string): RestErrorSummary {
  switch (status) {
    case 401:
      return { status, message: 'GitHub sign-in has expired or was revoked. Sign in again.' }
    case 403:
      return { status, message: 'GitHub denied this request.' }
    case 404:
      return { status, message: 'GitHub did not find the requested resource.' }
    case 409:
      return { status, message: 'GitHub reported a conflict with the existing resource.' }
    case 422:
      return { status, message: 'GitHub rejected the request payload.' }
    case 429:
      return { status, message: 'GitHub rate-limited this request. Try again later.' }
    default:
      if (status >= 500) return { status, message: 'GitHub service is unavailable. Try again later.' }
      return { status, message: `GitHub API returned ${status}` }
  }
}