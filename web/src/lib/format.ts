export function formatBytes(value?: number | null): string {
  const numericValue = typeof value === 'number' && Number.isFinite(value) ? value : undefined
  if (numericValue === undefined) return '—'
  if (numericValue === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(numericValue) / Math.log(1024)), units.length - 1)
  const scaled = numericValue / 1024 ** index
  return index === 0 ? `${scaled.toFixed(0)} ${units[index]}` : `${scaled.toFixed(1)} ${units[index]}`
}

export function formatPercent(value?: number | null): string {
  const numericValue = typeof value === 'number' && Number.isFinite(value) ? value : undefined
  if (numericValue === undefined) return '—'
  return `${numericValue.toFixed(1)}%`
}

export function formatSpeed(value?: number | null): string {
  const formatted = formatBytes(value)
  return formatted === '—' ? formatted : `${formatted}/s`
}
