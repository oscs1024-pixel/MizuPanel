import type { RangeOption, SettingsResponse } from '../types'

const retentionOptions: Array<{ value: RangeOption, label: string, detail: string }> = [
  { value: '6h', label: '6 小时', detail: '轻量测试环境，数据占用最少。' },
  { value: '24h', label: '24 小时', detail: '适合观察一天内的波动。' },
  { value: '3d', label: '3 天', detail: '适合排查短期异常。' },
  { value: '7d', label: '7 天', detail: '当前上限，保留一周趋势。' }
]

export function SystemSettingsPage({ settings, selectedRetention, saving, message, error, onSelectRetention, onSave }: { settings?: SettingsResponse, selectedRetention: RangeOption, saving: boolean, message?: string, error?: string, onSelectRetention: (retention: RangeOption) => void, onSave: () => void }) {
  return (
    <section aria-label="系统设置" className="soft-panel">
      <div className="soft-panel-header px-5 py-5">
        <p className="text-[11px] font-black uppercase tracking-[0.26em] text-primary">Settings</p>
        <h2 className="mt-1 font-display text-3xl font-black tracking-tight text-foreground">系统设置</h2>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-muted-foreground">先放真正会影响当前使用的设置：指标保留时间。保存后不需要重启 Server，会立即用于历史查询和后续清理。</p>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[0.66fr_0.34fr]">
        <section className="soft-card p-4">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-black tracking-[0.18em] text-primary">Metrics Retention</p>
              <h3 className="mt-1 text-xl font-black text-foreground">指标保留时间</h3>
            </div>
            <span className="soft-chip w-fit px-3 py-1 text-xs font-black text-muted-foreground">当前：{settings ? retentionLabel(settings.metrics_retention) : '加载中'}</span>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {retentionOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-label={option.label}
                aria-pressed={selectedRetention === option.value}
                onClick={() => onSelectRetention(option.value)}
                className={`soft-button min-h-36 border p-4 text-left focus:outline-none focus:ring-4 focus:ring-primary/20 ${selectedRetention === option.value ? 'border-primary/40 bg-primary text-primary-foreground shadow-sm' : 'border-border bg-surface/80 text-muted-foreground hover:bg-card hover:text-foreground'}`}
              >
                <span className="block text-lg font-black">{option.label}</span>
                <span className={`mt-2 block text-xs font-bold leading-5 ${selectedRetention === option.value ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>{option.detail}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm font-bold leading-6 text-warning">
            <p>从短保留改成长保留不会恢复已经清理的数据；从长保留改短保留后，下一轮清理会删除超出范围的数据。</p>
            <button type="button" onClick={onSave} disabled={saving} className="soft-button min-h-11 shrink-0 bg-primary px-4 text-sm font-black text-primary-foreground shadow-sm hover:brightness-110 focus:outline-none focus:ring-4 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60">
              {saving ? '保存中...' : '保存设置'}
            </button>
          </div>

          {message ? <p className="mt-3 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm font-black text-success">{message}</p> : null}
          {error ? <p className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-black text-danger">{error}</p> : null}
        </section>

        <aside className="soft-card p-4 text-sm font-bold leading-6 text-muted-foreground">
          <p className="text-xs font-black tracking-[0.18em] text-muted-foreground">说明</p>
          <ul className="mt-3 space-y-3">
            <li className="rounded-2xl border border-border/80 bg-surface/70 px-4 py-3">最大保留时间目前限制为 7 天，避免 SQLite 指标表无限增长。</li>
            <li className="rounded-2xl border border-border/80 bg-surface/70 px-4 py-3">历史记录页的可查询范围会跟随这个设置。</li>
            <li className="rounded-2xl border border-border/80 bg-surface/70 px-4 py-3">配置文件仍作为首次启动默认值；后台保存后以数据库设置为准。</li>
          </ul>
        </aside>
      </div>
    </section>
  )
}

function retentionLabel(value: RangeOption) {
  return retentionOptions.find((option) => option.value === value)?.label ?? value
}
