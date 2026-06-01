import type { RangeOption, SettingsResponse } from '../types'

const retentionOptions: Array<{ value: RangeOption, label: string, detail: string }> = [
  { value: '6h', label: '6 小时', detail: '轻量测试环境，数据占用最少。' },
  { value: '24h', label: '24 小时', detail: '适合观察一天内的波动。' },
  { value: '3d', label: '3 天', detail: '适合排查短期异常。' },
  { value: '7d', label: '7 天', detail: '当前上限，保留一周趋势。' }
]

export function SystemSettingsPage({ settings, selectedRetention, saving, message, error, onSelectRetention, onSave }: { settings?: SettingsResponse, selectedRetention: RangeOption, saving: boolean, message?: string, error?: string, onSelectRetention: (retention: RangeOption) => void, onSave: () => void }) {
  return (
    <section aria-label="系统设置" className="overflow-hidden rounded-[32px] border border-white/80 bg-white/90 shadow-glass backdrop-blur-xl">
      <div className="border-b border-slate-200 bg-[radial-gradient(circle_at_8%_0%,rgba(15,23,42,0.08),transparent_30%),linear-gradient(135deg,#ffffff,#f8fafc)] px-5 py-5">
        <p className="text-[11px] font-black uppercase tracking-[0.26em] text-slate-400">Settings</p>
        <h2 className="mt-1 font-display text-3xl font-black tracking-tight text-slate-950">系统设置</h2>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-500">先放真正会影响当前使用的设置：指标保留时间。保存后不需要重启 Server，会立即用于历史查询和后续清理。</p>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[0.66fr_0.34fr]">
        <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-black tracking-[0.18em] text-blue-500">Metrics Retention</p>
              <h3 className="mt-1 text-xl font-black text-slate-950">指标保留时间</h3>
            </div>
            <span className="w-fit rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-500">当前：{settings ? retentionLabel(settings.metrics_retention) : '加载中'}</span>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {retentionOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-label={option.label}
                aria-pressed={selectedRetention === option.value}
                onClick={() => onSelectRetention(option.value)}
                className={`min-h-36 rounded-[24px] border p-4 text-left transition focus:outline-none focus:ring-4 focus:ring-blue-100 ${selectedRetention === option.value ? 'border-slate-950 bg-slate-950 text-white shadow-xl shadow-slate-200' : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-950'}`}
              >
                <span className="block text-lg font-black">{option.label}</span>
                <span className={`mt-2 block text-xs font-bold leading-5 ${selectedRetention === option.value ? 'text-slate-300' : 'text-slate-500'}`}>{option.detail}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-800">
            <p>从短保留改成长保留不会恢复已经清理的数据；从长保留改短保留后，下一轮清理会删除超出范围的数据。</p>
            <button type="button" onClick={onSave} disabled={saving} className="min-h-11 shrink-0 rounded-2xl bg-slate-950 px-4 text-sm font-black text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-400">
              {saving ? '保存中...' : '保存设置'}
            </button>
          </div>

          {message ? <p className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
          {error ? <p className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</p> : null}
        </section>

        <aside className="rounded-[28px] border border-slate-200 bg-slate-50 p-4 text-sm font-bold leading-6 text-slate-600">
          <p className="text-xs font-black tracking-[0.18em] text-slate-400">说明</p>
          <ul className="mt-3 space-y-3">
            <li className="rounded-2xl bg-white px-4 py-3 shadow-sm">最大保留时间目前限制为 7 天，避免 SQLite 指标表无限增长。</li>
            <li className="rounded-2xl bg-white px-4 py-3 shadow-sm">历史记录页的可查询范围会跟随这个设置。</li>
            <li className="rounded-2xl bg-white px-4 py-3 shadow-sm">配置文件仍作为首次启动默认值；后台保存后以数据库设置为准。</li>
          </ul>
        </aside>
      </div>
    </section>
  )
}

function retentionLabel(value: RangeOption) {
  return retentionOptions.find((option) => option.value === value)?.label ?? value
}
