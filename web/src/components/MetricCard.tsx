type MetricCardProps = {
  label: string
  value: string
  tone?: 'blue' | 'green' | 'amber' | 'slate'
  detail?: string
}

const toneClasses = {
  blue: 'bg-blue-500 text-blue-600 ring-blue-100',
  green: 'bg-emerald-500 text-emerald-700 ring-emerald-100',
  amber: 'bg-amber-500 text-amber-700 ring-amber-100',
  slate: 'bg-slate-700 text-slate-700 ring-slate-100'
}

export function MetricCard({ label, value, tone = 'blue', detail }: MetricCardProps) {
  const [dot, text, ring] = toneClasses[tone].split(' ')

  return (
    <div className={`rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm ring-4 ${ring}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-black tracking-[0.16em] text-slate-400">{label}</p>
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
      </div>
      <p className={`font-display text-3xl font-black tracking-tight ${text}`}>{value}</p>
      {detail ? <p className="mt-1 text-sm font-semibold text-slate-500">{detail}</p> : null}
    </div>
  )
}
