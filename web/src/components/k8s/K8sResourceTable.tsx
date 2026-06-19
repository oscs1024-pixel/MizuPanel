import type { ReactNode } from 'react'

type Column<T> = {
  key: string
  title: string
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
      <div className="rounded-[14px] border border-border bg-card p-8 text-center">
        <div className="mb-3 inline-block h-6 w-6 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
        <p className="text-sm font-semibold text-muted-foreground">加载资源列表...</p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="rounded-[14px] border border-border bg-card p-8 text-center">
        <p className="text-sm font-semibold text-muted-foreground">{emptyText}</p>
      </div>
    )
  }

  return (
    <div className="rounded-[14px] border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {columns.map((column) => (
                <th key={column.key} className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">
                  {column.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={getKey(item)} className={index % 2 === 0 ? 'bg-card' : 'bg-muted/10'}>
                {columns.map((column) => (
                  <td key={column.key} className="px-4 py-3 text-sm font-semibold text-foreground">
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
