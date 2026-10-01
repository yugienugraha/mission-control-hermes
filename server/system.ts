import { execFile as execFileCallback } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const COMMAND_TIMEOUT_MS = 8_000
/** History: one sample per minute, kept for 24 hours. In-memory only, no database. */
export const SAMPLE_INTERVAL_MS = 60_000
export const HISTORY_LIMIT = 1_440
export const SERVICES = ['hermes-gateway', 'tailscaled']

export type ServiceState = 'active' | 'inactive' | 'unknown'
export type Health = 'ok' | 'warning' | 'critical'

export interface CpuSample { cores: number[]; loadAvg: [number, number, number] }
export interface MemSample { total: number; available: number; used: number }
export interface DiskSample { total: number; used: number; percent: number }
export interface NetSample { rxBytes: number; txBytes: number; rxRate: number; txRate: number }
export interface ProcessSample { command: string; percent: number; rssKb: number }
export interface ServiceSample { name: string; state: ServiceState }

export interface SystemSnapshot {
  cpu: CpuSample
  mem: MemSample
  disk: DiskSample
  net: NetSample
  uptimeSeconds: number
  processes: ProcessSample[]
  services: ServiceSample[]
  fetchedAt: string
}

/** One point of the 24h ring buffer: the numbers the sparklines draw. */
export interface HistoryPoint {
  at: string
  cpuPercent: number
  loadAvg: number
  memPercent: number
  diskPercent: number
  rxRate: number
  txRate: number
}

export interface SystemPage { current: SystemSnapshot; history: HistoryPoint[] }

// ---------------------------------------------------------------------------
// Pure parsers (unit-tested)

/** /proc/stat: cpu aggregate + per-core rows, in jiffies since boot. */
export function parseCpuStat(output: string): { total: { idle: number; busy: number }; cores: { idle: number; busy: number }[] } {
  const rows = output.split('\n').filter((line) => /^cpu\d*\s/.test(line))
  if (rows.length === 0) throw new Error('Unrecognized /proc/stat output.')
  const parse = (line: string) => {
    const fields = line.trim().split(/\s+/).slice(1).map(Number)
    const idle = (fields[3] ?? 0) + (fields[4] ?? 0)
    const busy = fields.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0) - idle
    return { idle, busy }
  }
  return { total: parse(rows[0]), cores: rows.slice(1).map(parse) }
}

/** /proc/meminfo: MemTotal and MemAvailable in kB. */
export function parseMemInfo(output: string): MemSample {
  const field = (name: string) => Number(new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(output)?.[1] ?? 0)
  const total = field('MemTotal') * 1024
  const available = field('MemAvailable') * 1024
  if (!total) throw new Error('Unrecognized /proc/meminfo output.')
  return { total, available, used: total - available }
}

/** `df -kP /`: one data row with 1K blocks. */
export function parseDf(output: string): DiskSample {
  const row = output.split('\n').find((line) => /^\S+\s+\d+\s+\d+\s+\d+\s+\d+%/.test(line))
  if (!row) throw new Error('Unrecognized df output.')
  const fields = row.trim().split(/\s+/)
  const total = Number(fields[1]) * 1024
  const used = Number(fields[2]) * 1024
  return { total, used, percent: total ? Math.round((used / total) * 100) : 0 }
}

/** /proc/net/dev: summed receive/transmit byte counters over every interface. */
export function parseNetDev(output: string): { rxBytes: number; txBytes: number } {
  const rows = output.split('\n').filter((line) => line.includes(':'))
  if (rows.length === 0) throw new Error('Unrecognized /proc/net/dev output.')
  return rows.reduce((sums, line) => {
    const [, rest] = line.split(':', 2)
    const fields = rest!.trim().split(/\s+/).map(Number)
    return { rxBytes: sums.rxBytes + (fields[0] ?? 0), txBytes: sums.txBytes + (fields[8] ?? 0) }
  }, { rxBytes: 0, txBytes: 0 })
}

/** `ps -eo comm=,pcpu=,rss= --sort=-rss`: top rows by resident memory. */
export function parseProcesses(output: string): ProcessSample[] {
  return output.split('\n').flatMap((line) => {
    const fields = line.trim().split(/\s+/)
    const command = fields[0]
    const percent = Number(fields[1])
    const rssKb = Number(fields[2])
    return command && Number.isFinite(percent) && Number.isFinite(rssKb) ? [{ command, percent, rssKb }] : []
  }).slice(0, 5)
}

export function parseServiceState(output: string): ServiceState {
  const state = output.trim().toLowerCase()
  return state === 'active' ? 'active' : state === 'inactive' || state === 'failed' ? 'inactive' : 'unknown'
}

export function percentBetween(previous: { idle: number; busy: number }, current: { idle: number; busy: number }): number {
  const idle = current.idle - previous.idle
  const total = current.busy - previous.busy + idle
  return total > 0 ? Math.min(100, Math.max(0, Math.round(((total - idle) / total) * 100))) : 0
}

export function healthFor(disk: DiskSample, mem: MemSample, services: ServiceSample[]): Health {
  if (disk.percent > 80 || services.some((service) => service.state !== 'active') || mem.available / mem.total < 0.1) return 'critical'
  if (disk.percent > 70 || mem.available / mem.total < 0.2) return 'warning'
  return 'ok'
}

// ---------------------------------------------------------------------------

/** Latest cpu readings and network counters, kept between calls for delta math. */
let previousCpu: { at: number; total: { idle: number; busy: number }; cores: { idle: number; busy: number }[] } | undefined
let previousNet: { at: number; rxBytes: number; txBytes: number } | undefined
const history: HistoryPoint[] = []
let sampler: ReturnType<typeof setInterval> | undefined

function rates(current: number, stored: { at: number; rxBytes: number; txBytes: number } | undefined, previous: number, at: number): number {
  if (!stored) return 0
  const seconds = (at - stored.at) / 1000
  return seconds > 0 ? Math.max(0, Math.round((current - previous) / seconds)) : 0
}

/** One full read of the host: /proc files plus two short read-only commands. */
export async function collectSystem(): Promise<SystemSnapshot> {
  const [stat, meminfo, loadavg, uptime, netdev, df, ps, services] = await Promise.all([
    readFile('/proc/stat', 'utf8'),
    readFile('/proc/meminfo', 'utf8'),
    readFile('/proc/loadavg', 'utf8'),
    readFile('/proc/uptime', 'utf8'),
    readFile('/proc/net/dev', 'utf8'),
    run('df', ['-kP', '/']),
    run('ps', ['-eo', 'comm=,pcpu=,rss=', '--sort=-rss']),
    Promise.all(SERVICES.map(async (name) => ({ name, state: await serviceState(name) }))),
  ])

  const at = Date.now()
  const cpu = parseCpuStat(stat)
  const corePercents = cpu.cores.map((core, index) => percentBetween(previousCpu?.cores[index] ?? core, core))
  previousCpu = { at, total: cpu.total, cores: cpu.cores }

  const net = parseNetDev(netdev)
  const netSample: NetSample = { ...net, rxRate: rates(net.rxBytes, previousNet, previousNet?.rxBytes ?? net.rxBytes, at), txRate: rates(net.txBytes, previousNet, previousNet?.txBytes ?? net.txBytes, at) }
  previousNet = { at, ...net }

  const loadFields = loadavg.trim().split(/\s+/).map(Number)
  const mem = parseMemInfo(meminfo)
  const disk = parseDf(df)
  const serviceList = [...services, { name: 'ruang', state: 'active' as ServiceState }]
  return {
    cpu: { cores: corePercents, loadAvg: [loadFields[0] ?? 0, loadFields[1] ?? 0, loadFields[2] ?? 0] },
    mem,
    disk,
    net: netSample,
    uptimeSeconds: Number(uptime.split(' ')[0] ?? 0),
    processes: parseProcesses(ps),
    services: serviceList,
    fetchedAt: new Date(at).toISOString(),
  }
}

/** The current snapshot; the sampler appends its history point separately. */
export async function getSystem(): Promise<SystemPage> {
  return { current: await collectSystem(), history }
}

/** Lazily started server-side sampler; one point per minute, 24h retention. */
export function startSystemSampler(): void {
  if (sampler) return
  void recordSample()
  sampler = setInterval(() => { void recordSample() }, SAMPLE_INTERVAL_MS)
  sampler.unref?.()
}

function average(values: number[]): number {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0
}

async function recordSample(): Promise<void> {
  try {
    const { current } = await getSystem()
    history.push({ at: current.fetchedAt, cpuPercent: average(current.cpu.cores), loadAvg: current.cpu.loadAvg[0], memPercent: Math.round((current.mem.used / current.mem.total) * 100), diskPercent: current.disk.percent, rxRate: current.net.rxRate, txRate: current.net.txRate })
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT)
  } catch { // A failed minute is skipped; the buffer keeps its old points.
  }
}

export function systemHistory(): HistoryPoint[] { return [...history] }
export function clearSystemState(): void { previousCpu = undefined; previousNet = undefined; history.length = 0; if (sampler) { clearInterval(sampler); sampler = undefined } }

async function run(file: string, args: string[]): Promise<string> {
  const { stdout } = await execFile(file, args, { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 1024 * 1024, env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' } })
  return stdout
}

/**
 * `systemctl is-active` for one service: the user manager first, then the system manager.
 * Exit codes disambiguate: 0 = active, 3 = inactive/failed (unit exists), other = no such unit
 * (hermes-gateway is a --user unit, tailscaled a system one). Both scopes unknown -> 'unknown'.
 */
async function serviceState(name: string): Promise<ServiceState> {
  const scopes: string[][] = [['--user'], []]
  for (const scope of scopes) {
    try {
      const { stdout } = await execFile('systemctl', [...scope, 'is-active', name], { timeout: COMMAND_TIMEOUT_MS, env: serviceEnv(scope.length > 0) })
      return parseServiceState(stdout)
    } catch (error) {
      const code = (error as { code?: number }).code
      const stdout = (error as { stdout?: string }).stdout
      if ((code === 0 || code === 3) && stdout !== undefined && stdout.trim()) return parseServiceState(stdout)
      // Exit 4 (or empty stdout): the unit does not exist in this scope; try the next one.
    }
  }
  return 'unknown'
}

/**
 * `systemctl --user` needs the session bus (inject XDG_RUNTIME_DIR when missing) and must not
 * believe it runs inside a unit: a server started from a systemd-managed shell inherits
 * SYSTEMD_EXEC_PID/INVOCATION_ID, which makes systemctl report that unit's state instead.
 */
function serviceEnv(user: boolean): NodeJS.ProcessEnv {
  const clean = { ...process.env }
  for (const key of ['SYSTEMD_EXEC_PID', 'MANAGERPID', 'INVOCATION_ID', 'JOURNAL_STREAM']) delete clean[key]
  if (!user) return clean
  if (clean.XDG_RUNTIME_DIR) return clean
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined
  return uid === undefined ? clean : { ...clean, XDG_RUNTIME_DIR: `/run/user/${uid}` }
}
