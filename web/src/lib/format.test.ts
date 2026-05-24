import { describe, expect, test } from 'vitest'

import { formatBytes, formatPercent, formatSpeed } from './format'

describe('format helpers', () => {
  test('formats byte values with binary units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1048576)).toBe('1.0 MB')
  })

  test('formats percentage values with one decimal', () => {
    expect(formatPercent(12.345)).toBe('12.3%')
  })

  test('formats network speeds as bytes per second', () => {
    expect(formatSpeed(2048)).toBe('2.0 KB/s')
  })
})
