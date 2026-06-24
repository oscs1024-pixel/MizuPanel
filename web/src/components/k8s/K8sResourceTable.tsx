import type { ReactNode } from 'react'

type Column<T> = {
  key: string
  title: string
  align?: 'left' | 'center' | 'right'
  render: (item: T) => ReactNode
}

type K8sResourceTableProps<T> = {
  columns: Column<T>[]
  items: T[]
  getKey: (item: T) => string
  emptyText: string
  loading?: boolean
}

export function K8sResourceTable<T>({ columns, items, getKey, emptyText, loading }: K8sResourceTableProps<T>) {
  if (loading) {
    return (
      <div className="rounded-[16px] border border-border bg-card p-8 text-center shadow-sm">
        <div className="mb-3 inline-block h-6 w-6 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
        <p className="text-sm font-bold text-muted-foreground">加载资源列表...</p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="rounded-[16px] border border-dashed border-border bg-card p-8 text-center shadow-sm">
        <p className="text-sm font-bold text-muted-foreground">{emptyText}</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-[16px] border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse">
          <thead>
            <tr className="border-b border-border bg-surface">
              {columns.map((column) => (
                <th key={column.key} className={`whitespace-nowrap px-4 py-3 text-xs font-black uppercase tracking-wider text-muted-foreground ${alignClass(column.align)}`}>
                  {column.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={getKey(item)} className="border-b border-border/60 bg-card last:border-0 hover:bg-muted/30">
                {columns.map((column) => (
                  <td key={column.key} className={`whitespace-nowrap px-4 py-3 text-sm font-semibold text-foreground ${alignClass(column.align)}`}>
                    {column.render(item)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function alignClass(align: Column<unknown>['align']): string {
  if (align === 'center') return 'text-center'
  if (align === 'right') return 'text-right'
  return 'text-left'
}
