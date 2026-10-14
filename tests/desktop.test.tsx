import { test, expect, mock } from 'claude-code/testing'

import { stripSvg } from '../hooks/register'

test('desktop draws Unicode in fixed-width cells, without the glyph rule', async ($, on) => {
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
      surface: 'desktop',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, bodyColumns } as never,
    })
    expect(await ui.find({ type: 'Text', text: /^context$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^24%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Svg' } as never)).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↻/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /#/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /\$1\.23/ })).toBeDefined()
    await ui.unmount()
  }
})

test('desktop bars are thin strips filled to their share', async () => {
  expect(stripSvg(0.5, 'green')).toContain('width="50%"')
  expect(stripSvg(0, 'green')).not.toContain('#4eba65')
  expect(stripSvg(1.2, 'red')).toContain('width="100%" height="6" rx="3" fill="#e5534b"')
})
