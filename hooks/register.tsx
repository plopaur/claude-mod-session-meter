import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Stats, Tokens30d } from '../types'

const EMPTY: Stats = {
  turns: 0,
  totalMs: 0,
  lastMs: null,
  turnTools: 0,
  sessionTools: 0,
  turnStartedAt: null,
}
const stats = atom({ plugin: 'session-meter', key: 'stats' } as const, EMPTY)
const now = atom({ plugin: 'session-meter', key: 'now' } as const, 0)
const isHidden = atom({ plugin: 'session-meter', key: 'isHidden' } as const, false)

const tokens30d = atom({ plugin: 'session-meter', key: 'tokens30d' } as const, null as Tokens30d | null)

const BAR = 14
const DAY_MS = 86_400_000

// Thresholds sit where rounding would carry into the next unit, so 999,999 reads 1.0M, never 1000k
export function millions(tokens: number): string {
  if (tokens >= 999_500_000) {
    return `${(tokens / 1e9).toFixed(1)}B`
  }
  if (tokens >= 9_950_000) {
    return `${Math.round(tokens / 1e6)}M`
  }
  if (tokens >= 999_500) {
    return `${(tokens / 1e6).toFixed(1)}M`
  }
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1e3)}k`
  }

  return String(tokens)
}
const LIMIT_BAR = 14
const WIDE_COLUMNS = 135
// Compact: the 5h bar starts under the context bar and the weekly bar ends where it ends
const COMPACT_LIMIT_BAR = 12
const COMPACT_COLUMNS = 74
const LIMIT_SUFFIX = 13 // ' 100% ↻23h59m'

// Every glyph is one cell wide in both sets, so the layout math is the same
const UNICODE = { full: '█', empty: '░', sep: '│', rule: '─', reset: '↻', up: '↑ ', down: '↓ ', dot: '·' }
const ASCII = { full: '#', empty: '-', sep: '|', rule: '-', reset: '~', up: 'in ', down: 'out ', dot: '-' }
type Glyphs = typeof UNICODE
let glyphs: Glyphs = UNICODE
// METER_CHARSET as read at session start; the desktop draws Unicode unless it says ascii
let forcedCharset: string | undefined
const sep = (g: Glyphs) => `  ${g.sep}  `
// Wide layout: the first separator on both rows is tighter and sits in the same column
const firstSep = (g: Glyphs) => ` ${g.sep} `
const CONTEXT_BAR_COMPACT = 2 * COMPACT_LIMIT_BAR + LIMIT_SUFFIX + 5 + 'weekly '.length
const LABEL = 'context  '
const TOKENS_WIDTH = 11 // ' 999k/1.5M', ' 1.2M/  2M'
// Wide layout: first column ends here on both rows, so api cost and weekly line up
const WIDE_FIRST = LABEL.length + BAR + 5 + TOKENS_WIDTH
// Desktop bar: stretches to its column, fill and track in the bar colors the terminal uses
const STRIP_HEIGHT = 6
const STRIP_COLORS: Record<string, string> = { green: '#4eba65', yellow: '#e5b84b', red: '#e5534b' }
export function stripSvg(fraction: number, color: string): string {
  const fill = Math.max(0, Math.min(100, fraction * 100))
  const r = STRIP_HEIGHT / 2

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${STRIP_HEIGHT}" preserveAspectRatio="none">` +
    `<rect width="100%" height="${STRIP_HEIGHT}" rx="${r}" fill="#888" fill-opacity="0.3"/>` +
    (fill > 0 ? `<rect width="${fill}%" height="${STRIP_HEIGHT}" rx="${r}" fill="${STRIP_COLORS[color] ?? color}"/>` : '') +
    '</svg>'
  )
}

const LIMITS = [
  { kind: 'five_hour', label: '5h limit' },
  { kind: 'seven_day', label: 'weekly' },
] as const

// Right-aligned in three columns so 5% and 100% take the same width
function pct(percent: number): string {
  return ` ${String(percent).padStart(3)}%`
}

function barColor(percent: number): string {
  return percent > 90 ? 'red' : percent > 80 ? 'yellow' : 'green'
}

function until(resetsAt: string | undefined, time: number, g: Glyphs): string {
  const at = resetsAt === undefined ? NaN : Date.parse(resetsAt)
  if (Number.isNaN(at)) {
    return ''
  }
  const minutes = Math.max(0, Math.round((at - time) / 60000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)

  const mark = g.reset

  return days > 0 ? ` ${mark}${days}d${hours}h` : hours > 0 ? ` ${mark}${hours}h${String(minutes % 60).padStart(2, '0')}m` : ` ${mark}${minutes}m`
}

const two = (n: number) => String(n).padStart(2, '0')

// Rounds once, then splits, so 119.6s reads 2m00s, never 1m60s
export function seconds(ms: number): string {
  const tenths = Math.round(ms / 100)
  if (tenths < 600) {
    return `${(tenths / 10).toFixed(1)}s`
  }
  const total = Math.round(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)

  return hours > 0 ? `${hours}h${two(minutes)}m` : `${minutes}m${two(total % 60)}s`
}

// At most four characters: 999k, then 1M, 1.5M
export function kilo(tokens: number): string {
  if (tokens >= 999_500) {
    return `${Number((tokens / 1e6).toFixed(1))}M`
  }

  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)
}

// Local calendar date, matching the dates Claude Code writes to stats-cache.json
export function localDate(time: number): string {
  const d = new Date(time)

  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

export const register: Register = (on, options) => {
  const yellowTokens = Number(options.contextYellowTokens)
  const redPercent = Number(options.contextRedPercent)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'meter',
      description: 'Hide or show the session meter above the prompt',
    })
    // Plain ASCII when the locale is not UTF-8 or the session is over ssh; METER_CHARSET=unicode|ascii overrides
    const forced = await $.env.get('METER_CHARSET')
    forcedCharset = forced
    const locale = (await $.env.get('LC_ALL')) || (await $.env.get('LC_CTYPE')) || (await $.env.get('LANG')) || ''
    const isRemote = Boolean((await $.env.get('SSH_CONNECTION')) || (await $.env.get('SSH_TTY')))
    const isUtf8 = /utf-?8/i.test(locale)
    glyphs = forced === 'unicode' || (forced !== 'ascii' && isUtf8 && !isRemote) ? UNICODE : ASCII
    // Needs the plugin to live under a `.claude/` directory; otherwise the 30d readout shows n/a
    const marker = $.plugin.root.indexOf('/.claude/')
    const home = marker === -1 ? null : $.plugin.root.slice(0, marker)
    // Claude Code's own daily usage cache; it is refreshed by Claude Code, not by this mod
    const refreshTokens = async () => {
      try {
        if (home === null) {
          throw new Error('no .claude directory above the plugin root')
        }
        const cache = JSON.parse(await $.fs.read(`${home}/.claude/stats-cache.json`)) as {
          dailyModelTokens?: { date: string; tokensByModel: Record<string, number> }[]
          modelUsage?: Record<string, Record<string, number>>
          firstSessionDate?: string
        }
        const since = (await $.clock.now()) - 30 * DAY_MS
        // Days are plain local YYYY-MM-DD strings; compare them as strings instead of parsing to UTC midnight
        const cutoff = localDate(since)
        let total = 0
        let asOf = ''
        for (const day of cache.dailyModelTokens ?? []) {
          asOf = day.date > asOf ? day.date : asOf
          if (day.date >= cutoff) {
            total += Object.values(day.tokensByModel).reduce((a, b) => a + b, 0)
          }
        }
        // modelUsage splits input/output but covers every day the cache holds; scale it to the 30 days
        let allInput = 0
        let allOutput = 0
        let allTotal = 0
        for (const m of Object.values(cache.modelUsage ?? {})) {
          allInput += m.inputTokens ?? 0
          allOutput += m.outputTokens ?? 0
          allTotal += (m.inputTokens ?? 0) + (m.outputTokens ?? 0) + (m.cacheReadInputTokens ?? 0) + (m.cacheCreationInputTokens ?? 0)
        }
        const share = allTotal > 0 ? Math.min(1, total / allTotal) : 0
        const input = Math.round(allInput * share)
        const output = Math.round(allOutput * share)
        // A missing or unparsable first-session date counts as an estimate
        const isEstimate = !(Date.parse(cache.firstSessionDate ?? '') >= since)
        await update($, tokens30d, () => ({ total, input, output, isEstimate, asOf }))
      } catch {
        await update($, tokens30d, () => null)
      }
    }
    void refreshTokens()
    let ticks = 0
    $.clock.every(1000, async () => {
      try {
        ticks += 1
        const current = await read($, stats)
        if (current.turnStartedAt !== null || ticks % 60 === 0) {
          const time = await $.clock.now()
          await update($, now, () => time)
        }
        if (ticks % 60 === 0) {
          await refreshTokens()
        }
      } catch {
        // a failed tick is retried on the next one
      }
    })

    return next(e)
  })

  on('command.run', { command: 'meter' }, async $ => {
    const hidden = await update($, isHidden, h => !h)

    return { text: hidden ? 'Session meter hidden.' : 'Session meter shown.' }
  })

  // /clear starts the session's cost over without a new session.start; start the counters over with it
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, stats, () => EMPTY)
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const time = await $.clock.now()
    await update($, now, () => time)
    await update($, stats, s => ({ ...s, turnTools: 0, turnStartedAt: time }))

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // Main loop only, matching turn.complete; subagent calls are not counted
    if (e.agentId === undefined) {
      void update($, stats, s => ({
        ...s,
        turnTools: s.turnTools + 1,
        sessionTools: s.sessionTools + 1,
      })).catch(() => undefined)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, stats, s => ({
        ...s,
        turns: s.turns + 1,
        totalMs: s.totalMs + e.durationMs,
        lastMs: e.durationMs,
        turnStartedAt: null,
      }))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) {
      return next(e)
    }

    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
    const Svg = 'Svg' in elements ? elements.Svg : null
    const s = await read($, stats)
    const time = await read($, now)
    const { context, cost, rateLimits } = await $.session.usage()
    const clockNow = await $.clock.now()

    // The desktop draws in a proportional font: columns are fixed-width boxes there, not padding,
    // and its own process carries no UTF-8 locale, so it draws Unicode unless METER_CHARSET=ascii
    const isDesktop = e.surface === 'desktop'
    const g = isDesktop && forcedCharset !== 'ascii' ? UNICODE : glyphs
    type TextStyle = { color?: string; dimColor?: boolean }
    const cell = (width: number, text: string, style: TextStyle, align: 'flex-start' | 'center' | 'flex-end' = 'flex-start') =>
      isDesktop ? (
        <Box width={width} flexShrink={0} justifyContent={align}>
          <Text {...style}>{text.trim()}</Text>
        </Box>
      ) : (
        <Text {...style}>{text}</Text>
      )
    // Desktop: a thin SVG strip in place of █ and ░, whose widths in a proportional font are not a cell's
    const bar = (width: number, filled: number, color: string) =>
      isDesktop && Svg !== null ? (
        <Box width={width} flexShrink={0} flexDirection="column" justifyContent="center">
          <Svg source={stripSvg(filled / width, color)} alt={`${Math.round((filled / width) * 100)}%`} height={STRIP_HEIGHT} />
        </Box>
      ) : (
        <Box flexDirection="row" flexShrink={0}>
          <Text color={color}>{g.full.repeat(filled)}</Text>
          <Text dimColor>{g.empty.repeat(width - filled)}</Text>
        </Box>
      )

    const percent = Math.round(context.percent ?? 0)
    const meterColor = percent > redPercent ? 'red' : (context.tokens ?? 0) > yellowTokens ? 'yellow' : 'green'
    const isCompact = e.props.bodyColumns < WIDE_COLUMNS
    // Wide: right-align both numbers so ' 48k/ 200k' and '999k/1000k' take the same width
    const tokens =
      context.tokens === undefined
        ? ''
        : isCompact || isDesktop
          ? ` ${kilo(context.tokens)}/${kilo(context.window)}`
          : ` ${kilo(context.tokens).padStart(4)}/${kilo(context.window).padStart(5)}`
    const barCells = isCompact ? CONTEXT_BAR_COMPACT : BAR
    const filled = Math.min(barCells, Math.round((percent / 100) * barCells))

    const isRunning = s.turnStartedAt !== null
    const turnText = isRunning
      ? seconds(Math.max(0, time - (s.turnStartedAt ?? time)))
      : s.lastMs === null
        ? 'no turns yet'
        : seconds(s.lastMs)
    const runningMs = isRunning ? Math.max(0, time - (s.turnStartedAt ?? time)) : 0
    const average = s.turns > 0 ? ` ${g.dot} avg ${seconds(s.totalMs / s.turns)}` : ''
    const total = s.turns > 0 || isRunning ? ` ${g.dot} total ${seconds(s.totalMs + runningMs)}` : ''

    const used30 = await read($, tokens30d)
    const limits = LIMITS.map(({ kind, label }, i) => {
      const limit = rateLimits.find(r => r.kind === kind)
      const lead = i === 0 ? '' : isCompact ? sep(g) : firstSep(g)
      const leadCell = lead === '' ? null : cell(lead.length, lead, { dimColor: true }, 'center')
      const name = `${label} `
      const length = isCompact ? COMPACT_LIMIT_BAR : LIMIT_BAR
      // Pad the first limit's suffix so the weekly bar starts at a fixed column
      const suffixWidth = isCompact ? LIMIT_SUFFIX : WIDE_FIRST - name.length - length
      if (limit === undefined) {
        if (isDesktop) {
          return (
            <Box key={kind} flexDirection="row">
              {leadCell}
              {cell(name.length, name, { dimColor: true })}
              {bar(length, 0, 'green')}
              {cell(i === 0 ? suffixWidth : ' n/a'.length, ' n/a', { dimColor: true })}
            </Box>
          )
        }
        return (
          <Box key={kind} flexDirection="row">
            <Text dimColor>{lead}{name}{g.empty.repeat(length)} n/a{i === 0 ? ' '.repeat(suffixWidth - ' n/a'.length) : ''}</Text>
          </Box>
        )
      }
      const used = Math.round(limit.percentUsed)
      const cells = Math.min(length, Math.round((used / 100) * length))
      const color = barColor(used)
      const reset = until(limit.resetsAt, clockNow, g)

      if (isDesktop) {
        return (
          <Box key={kind} flexDirection="row">
            {leadCell}
            {cell(name.length, name, { dimColor: true })}
            {bar(length, cells, color)}
            <Box flexDirection="row" flexShrink={0} width={i === 0 ? suffixWidth : undefined}>
              {cell(pct(used).length, pct(used), { color }, 'flex-end')}
              <Text dimColor>{reset}</Text>
            </Box>
          </Box>
        )
      }
      const pad = i === 0 ? ' '.repeat(Math.max(0, suffixWidth - pct(used).length - reset.length)) : ''

      return (
        <Box key={kind} flexDirection="row">
          <Text dimColor>{lead}{name}</Text>
          {bar(length, cells, color)}
          <Text color={color}>{pct(used)}</Text>
          <Text dimColor>{reset}{pad}</Text>
        </Box>
      )
    })

    const contextBar = (
      <Box flexDirection="row">
        {cell(LABEL.length, LABEL, { dimColor: true })}
        {bar(barCells, filled, meterColor)}
        {cell(pct(percent).length, pct(percent), { color: meterColor }, 'flex-end')}
        {isCompact ? <Text dimColor>{tokens}</Text> : cell(TOKENS_WIDTH, tokens.padEnd(TOKENS_WIDTH), { dimColor: true })}
      </Box>
    )
    const apiCost = (
      <Box flexDirection="row">
        <Text dimColor>api cost </Text>
        <Text>{cost === undefined ? 'n/a' : `$${cost.usd.toFixed(2)}`}</Text>
      </Box>
    )
    const tokens30 = (
      <Box flexDirection="row">
        <Text dimColor>30d tokens </Text>
        {used30 === null ? (
          <Text dimColor>n/a</Text>
        ) : (
          <Box flexDirection="row">
            <Text>{millions(used30.total)}</Text>
            <Text dimColor>  {g.up}</Text>
            <Text>{millions(used30.input)}</Text>
            <Text dimColor>  {g.down}</Text>
            <Text>{millions(used30.output)}</Text>
            <Text dimColor>{used30.isEstimate ? ' (est.)' : ''}{used30.asOf === '' ? '' : ` ${g.dot} to ${used30.asOf.slice(5)}`}</Text>
          </Box>
        )}
      </Box>
    )
    const dividerColumns = isCompact ? Math.min(COMPACT_COLUMNS, e.props.bodyColumns) : e.props.bodyColumns
    // The desktop frames the band itself; a rule of glyphs would not match its width
    const divider = isDesktop ? null : <Text dimColor wrap="truncate-end">{g.rule.repeat(Math.max(1, dividerColumns))}</Text>

    if (isCompact) {
      // Compact layout: four rows, each at most 74 columns
      return (
        <Box flexDirection="column">
          {divider}
          {contextBar}
          <Box flexDirection="row">{limits}</Box>
          <Box flexDirection="row">
            <Text dimColor>tools </Text>
            <Text>{s.turnTools}</Text>
            <Text dimColor>/</Text>
            <Text>{s.sessionTools}</Text>
            <Text dimColor>{sep(g)}turn </Text>
            <Text color={isRunning ? 'cyan' : undefined}>{turnText}</Text>
            <Text dimColor>{average}{total}</Text>
          </Box>
          <Box flexDirection="row">
            {tokens30}
            <Text dimColor>{sep(g)}</Text>
            {apiCost}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {divider}
        <Box flexDirection="row">
          {contextBar}
          {cell(firstSep(g).length, firstSep(g), { dimColor: true }, 'center')}
          {apiCost}
          <Text dimColor>{sep(g)}tools </Text>
          <Text>{s.turnTools}</Text>
          <Text dimColor> turn / </Text>
          <Text>{s.sessionTools}</Text>
          <Text dimColor> session{sep(g)}turn </Text>
          <Text color={isRunning ? 'cyan' : undefined}>{turnText}</Text>
          <Text dimColor>{average}{total}</Text>
        </Box>
        <Box flexDirection="row">
          {limits}
          <Text dimColor>{sep(g)}</Text>
          {tokens30}
        </Box>
      </Box>
    )
  })
}
