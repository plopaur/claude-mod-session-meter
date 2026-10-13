# session-meter

A [Claude Code](https://claude.com/claude-code) mod that draws a live status band above the prompt: context usage, rate limits, session cost, tool calls, turn timing and 30-day token totals.

## Features

- **Context bar** with percent and tokens used / window. Green; yellow above 150k tokens; red above 50% of the window (both configurable, see below).
- **Rate limit bars** for the 5-hour and weekly limits, with percent used and a countdown to reset (`↻`). Green; yellow above 80%; red above 90%.
- **API cost** of the current session (`n/a` if unavailable).
- **Tool call counts** for this turn and this session (main loop only; subagent calls are not counted).
- **Turn timing**: elapsed time of the current turn (cyan while it runs), otherwise the duration of the last turn, plus average and total (`12.3s`, `2m03s`, `1h02m`). Shows `no turns yet` before the first turn.
- Tool counts and turn timing start over on `/clear`, as the API cost does.
- **30-day token totals** (total, input `↑`, output `↓`) read from `~/.claude/stats-cache.json`.
- **Two layouts** that switch on terminal width: wide (2 rows, from 135 columns) and compact (4 rows, 74 columns). Columns are fixed-width, so values do not shift as numbers change, and in the wide layout `weekly` lines up with `api cost`.
- **ASCII mode** for ssh and non-UTF-8 terminals, detected automatically.
- **`/meter`** command to toggle the meter.
- Hides itself while a survey is shown. Updates every second during a turn and once a minute otherwise.

## Layouts

Wide, at 135 columns or more:

```
────────────────────────────────────────
context  ███░░░░░░░░░░░  24%  48k/ 200k │ api cost $1.23  │  tools 4 turn / 31 session  │  turn 12.3s · avg 9.8s · total 2m03s
5h limit ██████░░░░░░░░  41% ↻2h10m     │ weekly ███░░░░░░░░░░░  22% ↻4d3h  │  30d tokens 710M  ↑ 6k  ↓ 5.5M (est.) · to 10-10
```

Compact, below 135 columns (fits 74 columns):

```
──────────────────────────────────────────────────────────────────────────
context  ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  24% 48k/200k
5h limit █████░░░░░░░  41% ↻2h10m   │  weekly ███░░░░░░░░░  22% ↻4d3h
tools 4/31  │  turn 12.3s · avg 9.8s · total 2m03s
30d tokens 710M  ↑ 6k  ↓ 5.5M (est.) · to 10-10  │  api cost $1.23
```

## Fields

| Field | Source |
|---|---|
| `context` | Context window usage from `$.session.usage()`; green; yellow above 150k tokens; red above 50% (configurable) |
| `api cost` | Session cost from `$.session.usage()`, `n/a` if unavailable |
| `tools` | Tool calls this turn / this session. Main loop only; subagent calls are not counted |
| `turn` | Elapsed time of the current turn (cyan), otherwise the last turn's duration, plus average and total (main loop only) |
| `5h limit`, `weekly` | Rate limits with percent used and time until reset (`↻`); green, yellow above 80%, red above 90% |
| `30d tokens` | Total, input (`↑`) and output (`↓`) tokens over the last 30 days, from `~/.claude/stats-cache.json` |

### About the 30-day figures

- The total sums `dailyModelTokens` (which includes cache tokens) for days on or after the cutoff date (30 days ago, by your local date).
- The cache only gives input/output split for *all* cached days, so the split is scaled by the 30-day share of the total. It assumes a similar input/output mix throughout.
- `(est.)` appears when the cache starts before the 30-day window or has no valid `firstSessionDate`.
- `to MM-DD` is the newest day in the cache. Claude Code refreshes that file, not this mod, so it can lag.
- The mod re-reads the file once a minute.
- It locates the file by finding `/.claude/` in the plugin path. If the plugin lives elsewhere, the 30d field shows `n/a`.

## SSH and plain terminals

The meter switches to plain ASCII when the locale is not UTF-8 or the session runs over ssh (`SSH_CONNECTION` or `SSH_TTY` is set), because fonts and locales on the remote side often lack `█ ░ │ ↻`. Every glyph is one cell wide in both sets, so the layout does not change.

```
--------------------------------------------------------------------------
context  ############-------------------------------------  24% 48k/200k
5h limit #####-------  41% ~2h10m   |  weekly ###---------  22% ~4d3h
tools 4/31  |  turn 12.3s - avg 9.8s - total 2m03s
30d tokens 710M  in 6k  out 5.5M (est.) - to 10-10  |  api cost $1.23
```

Set `METER_CHARSET=unicode` or `METER_CHARSET=ascii` to override the detection.

## Configuration

| Option | Default | Meaning |
|---|---|---|
| `contextYellowTokens` | `150000` | The context bar turns yellow above this many tokens |
| `contextRedPercent` | `50` | The context bar turns red above this percent of the window |

Set them in the `/config` menu (or under `pluginConfigs` in settings). A change reloads the mod.

## Install

```
/plugin install session-meter --marketplace plopaur/claude-mod-session-meter
```

## Usage

- `/meter` toggles the meter on and off.

## Files

- `hooks/register.tsx`: all logic and rendering
- `hooks/hooks.json`: module list
- `types/index.d.ts`: state types
- `tests/`: render, charset, and time and number formatting tests (`claude plugin test .`)
- `.claude-plugin/`: plugin manifest and `marketplace.json`; Claude Code writes its type definitions to `types/` there (git-ignored)

## Known limits

- Rows are not truncated; below 74 columns they wrap.
- The clock ticks every second only while a turn runs; otherwise it updates once a minute, so reset countdowns refresh at that rate.

## License

[MIT](LICENSE)
