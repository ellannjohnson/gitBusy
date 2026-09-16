// PROD-BL-005 — single source of truth for the gitBusy base path.
// Vite's `base` setting and the runtime URL constants must agree;
// this module is imported by vite.config.ts and by every server
// module that constructs URLs or accepts the production request
// listener.
//
// We have deliberately NOT made this an environment variable. The
// OAuth Device Flow redirect URL is registered against
// `/gitbusy/callback` with GitHub and changing it requires a
// coordinated GitHub app update. If a future distribution requires a
// different path, this constant and the packaging step are the only
// edit points.
export const BASE_PATH = '/gitbusy/'
export const BASE_PATH_PREFIX = '/gitbusy'
