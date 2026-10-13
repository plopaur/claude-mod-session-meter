import { test, expect, mock } from 'claude-code/testing'

const usage = {
  startedAt: 0,
  context: { tokens: 48000, window: 200000, percent: 24 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 41, resetsAt: '2030-01-01T00:00:00Z' },
    { kind: 'seven_day', percentUsed: 22 },
  ],
  cost: { usd: 1.23 },
}

async function draw($: Parameters<Parameters<typeof test>[1]>[0], bodyColumns: number) {
  const ui = await $.ui.mount({
    plugin: 'session-meter',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, bodyColumns } as never,
  })
  const found = {
    unicode: await ui.find({ type: 'Text', text: /[█░│↻]/ }),
    ascii: await ui.find({ type: 'Text', text: /[#-]{5}/ }),
  }
  await ui.unmount()

  return found
}

for (const [name, env, ascii] of [
  ['over ssh', { LANG: 'en_US.UTF-8', SSH_CONNECTION: '1 2 3 4' }, true],
  ['without a UTF-8 locale', { LANG: 'C' }, true],
  ['forced unicode', { LANG: 'C', METER_CHARSET: 'unicode' }, false],
  ['local UTF-8', { LANG: 'en_US.UTF-8' }, false],
] as const) {
  test(`meter uses ${ascii ? 'ASCII' : 'Unicode'} ${name}`, async ($, on) => {
    mock.clock(on)
    mock.env(on, env)
    on('session.usage', async () => ({ value: usage }) as never)
    on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    await ($ as never as { session: { start: (a: unknown) => Promise<unknown> } }).session.start({
      cwd: '/',
      surface: 'terminal',
      isInteractive: true,
    })
    for (const columns of [80, 140]) {
      const found = await draw($, columns)
      expect(found.unicode !== undefined).toBe(!ascii)
      expect(found.ascii !== undefined).toBe(ascii)
    }
  })
}
