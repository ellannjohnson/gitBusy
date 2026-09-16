// PROD-BL-001 — log-line shape used by the production server.
// Pure function so it is trivially testable; the production entry
// point calls logLine(process.stdout, 'info', msg) etc. No JSON, no
// schema, no external dependency — just enough structure that
// operators can grep for time and severity without parsing raw
// output.
//
// Kept in its own module so unit tests can import it without
// triggering runProductionServer.ts's module-level `main()`.

export const logLevels = ['info', 'warn', 'error'] as const
export type LogLevel = typeof logLevels[number]

export function formatLogLine(now: Date, level: LogLevel, msg: string): string {
  return `${now.toISOString()} ${level} ${msg}\n`
}

export function logLine(stream: NodeJS.WritableStream, level: LogLevel, msg: string): void {
  stream.write(formatLogLine(new Date(), level, msg))
}
