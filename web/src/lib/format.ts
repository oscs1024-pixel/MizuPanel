export function formatBytes(value: number): string {
  if (value === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const scaled = value / 1024 ** index
  return index === 0 ? `${scaled.toFixed(0)} ${units[index]}` : `${scaled.toFixed(1)} ${units[index]}`
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

export function formatSpeed(value: number): string {
  return `${formatBytes(value)}/s`
}
