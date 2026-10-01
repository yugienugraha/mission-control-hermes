import { formatBytes } from '../format.ts'
import { usePolling } from '../polling.ts'
import type { HistoryPoint, ServiceSample, SystemPageSnapshot, SystemSnapshot } from '../types.ts'
import { EmptyState, LoadingState, PageTitle } from '../ui.tsx'

type Health = 'ok' | 'warning' | 'critical'

interface Metric { label: string; value: string; detail: string; health: Health; points: number[]; max?: number }

const SERVICE_LABEL: Record<ServiceSample['state'], string> = { active: 'running', inactive: 'down', unknown: 'unknown' }
/** The sparkline shows the most recent hour of the 24h buffer. */
const SPARK_POINTS = 60

function healthOf(percent: number, warn: number, critical: number): Health {
  return percent > critical ? 'critical' : percent > warn ? 'warning' : 'ok'
}

function serviceHealth(services: ServiceSample[]): Health {
  return services.some((service) => service.state !== 'active') ? 'critical' : 'ok'
}

function bytesRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

function formatUptime(seconds: number): string {
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

function average(values: number[]): number {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0
}

/** The recent history values for one metric; `pick` selects the field. */
function sparkPoints(history: HistoryPoint[], pick: (point: HistoryPoint) => number): number[] {
  return history.slice(-SPARK_POINTS).map(pick)
}

function metrics(snapshot: SystemSnapshot, history: HistoryPoint[]): Metric[] {
  const memPercent = Math.round((snapshot.mem.used / snapshot.mem.total) * 100)
  return [
    { label: 'CPU', value: `${average(snapshot.cpu.cores)}%`, detail: `load ${snapshot.cpu.loadAvg.map((load) => load.toFixed(2)).join(' ')} · ${snapshot.cpu.cores.length} cores`, health: 'ok', points: sparkPoints(history, (point) => point.cpuPercent), max: 100 },
    { label: 'RAM', value: `${memPercent}%`, detail: `${formatBytes(snapshot.mem.used)} used · ${formatBytes(snapshot.mem.available)} available`, health: healthOf(memPercent, 80, 90), points: sparkPoints(history, (point) => point.memPercent), max: 100 },
    { label: 'Disk /', value: `${snapshot.disk.percent}%`, detail: `${formatBytes(snapshot.disk.used)} of ${formatBytes(snapshot.disk.total)}`, health: healthOf(snapshot.disk.percent, 70, 80), points: sparkPoints(history, (point) => point.diskPercent), max: 100 },
    { label: 'Network', value: `↓ ${bytesRate(snapshot.net.rxRate)}`, detail: `↑ ${bytesRate(snapshot.net.txRate)} out`, health: 'ok', points: sparkPoints(history, (point) => point.rxRate) },
    { label: 'Uptime', value: formatUptime(snapshot.uptimeSeconds), detail: `${history.length} samples in the last 24h`, health: 'ok', points: sparkPoints(history, (point) => point.loadAvg) },
    { label: 'Services', value: `${snapshot.services.filter((service) => service.state === 'active').length}/${snapshot.services.length} up`, detail: snapshot.services.map((service) => `${service.name}: ${SERVICE_LABEL[service.state]}`).join(', '), health: serviceHealth(snapshot.services), points: [] },
  ]
}

/** One card: metric label, current value, threshold badge and a 60-minute sparkline. */
function MetricCard({ metric }: { metric: Metric }) {
  const width = 220
  const height = 34
  const max = metric.max ?? Math.max(...metric.points, 1)
  const points = metric.points.map((value, index) => `${(index / Math.max(metric.points.length - 1, 1)) * width},${height - (value / max) * height}`).join(' ')
  return <article className="system-card">
    <header><span>{metric.label}</span><span className={`badge ${metric.health}`}>{metric.health}</span></header>
    <strong>{metric.value}</strong>
    <small>{metric.detail}</small>
    {metric.points.length > 1 && <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${metric.label} history`}><polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>}
  </article>
}

/** Top memory consumers; the server returns at most five rows. */
function ProcessTable({ processes }: { processes: SystemSnapshot['processes'] }) {
  return <div className="panel">
    <h2>Top processes</h2>
    {processes.length === 0 ? <p className="card-note">No process data.</p> : <table className="log-table"><thead><tr><th>Command</th><th>CPU</th><th>Memory</th></tr></thead><tbody>{processes.map((process) => <tr key={process.command}><td><code>{process.command}</code></td><td>{process.percent}%</td><td>{formatBytes(process.rssKb * 1024)}</td></tr>)}</tbody></table>}
  </div>
}

export function System() {
  const system = usePolling<SystemPageSnapshot>('/api/system', 10_000)
  const data = system.status === 'ready' ? system.data : undefined
  return <><PageTitle eyebrow="VITALS" title="System">Live health of the VPS itself: CPU, memory, disk, network, uptime and the services Ruang depends on. One sample per minute, 24 hours of history, read only.</PageTitle>
    {system.status === 'pending' ? <LoadingState message="Reading system stats..."/> : !data ? <EmptyState title="Not Available">The Ruang API could not be reached.</EmptyState> : <>
      <div className="system-grid">{metrics(data.current, data.history).map((metric) => <MetricCard key={metric.label} metric={metric}/>)}</div>
      <ProcessTable processes={data.current.processes}/>
    </>}
  </>
}
