import { describe, expect, it } from 'vitest'
import {
  HISTORY_LIMIT, parseCpuStat, parseDf, parseMemInfo, parseNetDev, parseProcesses, parseServiceState,
  percentBetween, healthFor,
  type DiskSample, type MemSample, type ServiceSample,
} from './system.js'

describe('system parsers', () => {
  it('parses /proc/stat aggregate and per-core jiffies', () => {
    const stat = `cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 60 0 30 400 25 0 0 0 0 0\ncpu1 40 0 20 400 25 0 0 0 0 0\nintr 123\n`
    const parsed = parseCpuStat(stat)
    expect(parsed.cores).toHaveLength(2)
    expect(parsed.total).toEqual({ idle: 850, busy: 150 })
    expect(parsed.cores[0]).toEqual({ idle: 425, busy: 90 })
  })

  it('parses /proc/meminfo into bytes', () => {
    const sample = parseMemInfo('MemTotal:  7654320 kB\nMemFree:    100000 kB\nMemAvailable: 3000000 kB\nSwapTotal: 0 kB\n')
    expect(sample.total).toBe(7654320 * 1024)
    expect(sample.available).toBe(3000000 * 1024)
    expect(sample.used).toBe((7654320 - 3000000) * 1024)
    expect(() => parseMemInfo('Garbage: 1 kB')).toThrow('Unrecognized /proc/meminfo output.')
  })

  it('parses df -kP and computes the used percent', () => {
    expect(parseDf('Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/vda1 51200000 22528000 26048000 47% /\n')).toEqual({ total: 51200000 * 1024, used: 22528000 * 1024, percent: 44 })
    expect(() => parseDf('Filesystem 1K-blocks\n')).toThrow('Unrecognized df output.')
  })

  it('sums receive and transmit counters over interfaces', () => {
    const dev = 'Inter-|   Receive\n face |bytes packets\n  lo: 100 1 0 0 0 0 0 0 20 1\neth0: 900 5 0 0 0 0 0 0 380 4\n'
    expect(parseNetDev(dev)).toEqual({ rxBytes: 1000, txBytes: 400 })
  })

  it('keeps at most five processes with numeric fields', () => {
    const ps = 'node 12.5 900000\npostgres 3.0 500000\nbad x y\nnode 1.0 100000\nnode 0.5 90000\nnode 0.2 80000\nnode 0.1 70000\n'
    expect(parseProcesses(ps)).toEqual([
      { command: 'node', percent: 12.5, rssKb: 900000 },
      { command: 'postgres', percent: 3, rssKb: 500000 },
      { command: 'node', percent: 1, rssKb: 100000 },
      { command: 'node', percent: 0.5, rssKb: 90000 },
      { command: 'node', percent: 0.2, rssKb: 80000 },
    ])
  })

  it('maps systemctl is-active output', () => {
    expect(parseServiceState('active\n')).toBe('active')
    expect(parseServiceState('inactive\n')).toBe('inactive')
    expect(parseServiceState('failed\n')).toBe('inactive')
    expect(parseServiceState('weird\n')).toBe('unknown')
  })

  it('computes cpu percent from two jiffies snapshots', () => {
    expect(percentBetween({ idle: 0, busy: 0 }, { idle: 90, busy: 10 })).toBe(10)
    expect(percentBetween({ idle: 100, busy: 100 }, { idle: 110, busy: 100 })).toBe(0)
    expect(percentBetween({ idle: 0, busy: 0 }, { idle: 0, busy: 0 })).toBe(0)
  })

  it('grades health from disk, memory and services', () => {
    const mem = (available: number): MemSample => ({ total: 7_600_000_000, available, used: 7_600_000_000 - available })
    const disk = (percent: number): DiskSample => ({ total: 1, used: 1, percent })
    const services = (states: ServiceSample['state'][]): ServiceSample[] => states.map((state, index) => ({ name: `svc${index}`, state }))
    expect(healthFor(disk(50), mem(3_000_000_000), services(['active', 'active']))).toBe('ok')
    expect(healthFor(disk(75), mem(3_000_000_000), services(['active']))).toBe('warning')
    expect(healthFor(disk(85), mem(3_000_000_000), services(['active']))).toBe('critical')
    expect(healthFor(disk(50), mem(1_000_000_000), services(['active']))).toBe('warning')
    expect(healthFor(disk(50), mem(3_000_000_000), services(['inactive']))).toBe('critical')
  })

  it('keeps the documented history shape', () => {
    expect(HISTORY_LIMIT).toBe(1440)
  })
})
