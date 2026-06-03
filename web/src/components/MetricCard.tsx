type MetricCardProps = {
  label: string
  value: string
  tone?: 'blue' | 'green' | 'amber' | 'slate'
  detail?: string
}

const toneClasses = {
  blue: 'bg-info text-info ring-info/15',
  green: 'bg-success text-success ring-success/15',
  amber: 'bg-warning text-warning ring-warning/15',
  slate: 'bg-muted-foreground text-foreground ring-border'
}

export function MetricCard({ label, value, tone = 'blue', detail }: MetricCardProps) {
  const [dot, text, ring] = toneClasses[tone].split(' ')

  return (
    <div className={`rounded-2xl border border-border bg-card p-4 shadow-sm ring-4 ${ring}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-black tracking-[0.16em] text-muted-foreground">{label}</p>
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
      </div>
      <p className={`font-display text-3xl font-black tracking-tight ${text}`}>{value}</p>
      {detail ? <p className="mt-1 text-sm font-semibold text-muted-foreground">{detail}</p> : null}
    </div>
  )
}
