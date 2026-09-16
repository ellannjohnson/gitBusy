export function summarizeGithubGraphqlError(message: string) {
  const lowerMessage = message.toLowerCase()
  const restrictionMarker = ' organization has enabled oauth app access restrictions'
  const restrictionIndex = lowerMessage.indexOf(restrictionMarker)
  const organization = restrictionIndex >= 0
    ? message.slice(0, restrictionIndex).trim().slice(message.slice(0, restrictionIndex).trim().lastIndexOf(' ') + 1).replaceAll('`', '').replaceAll("'", '').replaceAll('"', '')
    : ''

  if (lowerMessage.includes('oauth app access restrictions')) {
    const subject = organization
      ? `${organization} ${organization === 'organization' ? '' : 'organization'}`.trim()
      : 'an organization'
    return {
      status: 403,
      message: `GitHub blocked access because ${subject} restricts OAuth apps. An organization owner must approve gitBusy in the organization's Settings → Third-party access → OAuth app policy before list changes can be synchronized.`,
    }
  }
  if (lowerMessage.includes('resource not accessible')
    || lowerMessage.includes('user permission')
    || lowerMessage.includes('requires one of the following scopes')
    || (lowerMessage.includes('scope') && lowerMessage.includes('user'))) {
    return {
      status: 403,
      message: 'GitHub list management requires the user permission. Sign out of gitBusy and sign in again to approve it.',
    }
  }
  return { status: 502, message: `GitHub lists request failed: ${message.slice(0, 300)}` }
}
