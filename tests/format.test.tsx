import { test, expect } from 'claude-code/testing'

import { kilo, localDate, millions, seconds } from '../hooks/register'

test('seconds rounds once, then splits into minutes and hours', async () => {
  expect(seconds(0)).toBe('0.0s')
  expect(seconds(12_345)).toBe('12.3s')
  expect(seconds(59_940)).toBe('59.9s')
  expect(seconds(59_970)).toBe('1m00s')
  expect(seconds(60_000)).toBe('1m00s')
  expect(seconds(119_600)).toBe('2m00s')
  expect(seconds(123_000)).toBe('2m03s')
  expect(seconds(3_599_400)).toBe('59m59s')
  expect(seconds(3_599_600)).toBe('1h00m')
  expect(seconds(7_380_000)).toBe('2h03m')
})

test('kilo stays within four characters', async () => {
  expect(kilo(0)).toBe('0')
  expect(kilo(999)).toBe('999')
  expect(kilo(1000)).toBe('1k')
  expect(kilo(48_000)).toBe('48k')
  expect(kilo(200_000)).toBe('200k')
  expect(kilo(999_499)).toBe('999k')
  expect(kilo(999_500)).toBe('1M')
  expect(kilo(1_000_000)).toBe('1M')
  expect(kilo(1_500_000)).toBe('1.5M')
  for (const n of [0, 999, 999_499, 999_500, 1_234_567, 9_999_999]) {
    expect(kilo(n).length).toBeLessThanOrEqual(4)
  }
})

test('millions carries into the next unit instead of rounding up', async () => {
  expect(millions(400)).toBe('400')
  expect(millions(6_100)).toBe('6k')
  expect(millions(999_499)).toBe('999k')
  expect(millions(999_500)).toBe('1.0M')
  expect(millions(5_500_000)).toBe('5.5M')
  expect(millions(9_949_999)).toBe('9.9M')
  expect(millions(9_950_000)).toBe('10M')
  expect(millions(710_000_000)).toBe('710M')
  expect(millions(999_499_999)).toBe('999M')
  expect(millions(999_500_000)).toBe('1.0B')
  expect(millions(2_340_000_000)).toBe('2.3B')
})

test('localDate is the local calendar day', async () => {
  const d = new Date(2026, 0, 5, 23, 30)
  expect(localDate(d.getTime())).toBe('2026-01-05')
})
