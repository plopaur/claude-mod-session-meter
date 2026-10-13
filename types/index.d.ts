export type Stats = {
  turns: number
  totalMs: number
  lastMs: number | null
  turnTools: number
  sessionTools: number
  turnStartedAt: number | null
}

export type Tokens30d = { total: number; input: number; output: number; isEstimate: boolean; asOf: string }

declare module 'claude-code' {
  interface PluginState {
    'session-meter': { stats: Stats; now: number; isHidden: boolean; tokens30d: Tokens30d | null }
  }
}
