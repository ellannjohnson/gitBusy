export const GITHUB_OAUTH_SCOPES = ['repo', 'read:user', 'read:org', 'user', 'offline_access'] as const

export type DeviceTokenResult =
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'authorized'; accessToken: string; tokenType: string; scope: string }
  | { status: 'error'; message: string }

export function buildDeviceCodeRequest(clientId: string) {
  const body = new URLSearchParams()
  body.set('client_id', clientId)
  body.set('scope', GITHUB_OAUTH_SCOPES.join(' '))
  return body
}

export function classifyDeviceTokenResponse(payload: unknown): DeviceTokenResult {
  if (!payload || typeof payload !== 'object') {
    return { status: 'error', message: 'GitHub sign-in returned an invalid response' }
  }
  const value = payload as Record<string, unknown>
  const error = typeof value.error === 'string' ? value.error : ''
  if (error === 'authorization_pending') return { status: 'pending' }
  if (error === 'slow_down') return { status: 'slow_down' }
  if (error) return { status: 'error', message: `GitHub sign-in failed: ${error}` }
  if (typeof value.access_token === 'string' && value.access_token.length > 0) {
    return {
      status: 'authorized',
      accessToken: value.access_token,
      tokenType: typeof value.token_type === 'string' && value.token_type ? value.token_type : 'bearer',
      scope: typeof value.scope === 'string' ? value.scope : '',
    }
  }
  return { status: 'error', message: 'GitHub sign-in returned an invalid response' }
}

export function nextDevicePollDelay(result: Pick<DeviceTokenResult, 'status'>, intervalSeconds: number) {
  const interval = Number.isFinite(intervalSeconds) ? Math.max(1, Math.floor(intervalSeconds)) : 5
  return result.status === 'slow_down' ? interval + 5 : interval
}
