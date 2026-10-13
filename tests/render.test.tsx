import { test, expect, mock } from 'claude-code/testing'

test('meter band renders in the compact and wide layouts', async ($, on) => {
  mock.clock(on)
  on('session.usage', async () => ({ value: {
    startedAt: 0,
    context: { tokens: 48000, window: 200000, percent: 24 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 41, resetsAt: '2030-01-01T00:00:00Z' },
      { kind: 'seven_day', percentUsed: 22 },
    ],
    cost: { usd: 1.23 },
  } }) as never)
  for (const bodyColumns of [80, 135]) {
    const ui = await $.ui.mount({
      plugin: 'session-meter',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, bodyColumns } as never,
    })
    expect(await ui.find({ type: 'Text', text: /context/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$1\.23/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /30d tokens/ })).toBeDefined()
    await ui.unmount()
  }
})
