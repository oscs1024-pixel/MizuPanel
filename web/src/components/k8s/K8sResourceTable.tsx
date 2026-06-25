import { Fragment, type ReactNode } from 'react'

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
  expandedKey?: string
  renderExpanded?: (item: T) => ReactNode
  minWidth?: number
}

export function K8sResourceTable<T>({ columns, items, getKey, emptyText, loading, expandedKey, renderExpanded, minWidth = 980 }: K8sResourceTableProps<T>) {
  if (loading) {
    return (
      <div className="soft-empty-state p-8 text-center">
        <div className="mb-3 inline-block h-6 w-6 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
        <p className="text-sm font-bold text-muted-foreground">加载资源列表...</p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="soft-empty-state p-8 text-center">
        <p className="text-sm font-bold text-muted-foreground">{emptyText}</p>
      </div>
    )
  }

  return (
    <div className="soft-table">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth }}>
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
            {items.map((item) => {
              const key = getKey(item)
              const expanded = renderExpanded && expandedKey === key
              return (
                <Fragment key={key}>
                  <tr className="border-b border-border/60 bg-card last:border-0 hover:bg-muted/30">
                    {columns.map((column) => (
                      <td key={column.key} className={`whitespace-nowrap px-4 py-3 text-sm font-semibold text-foreground ${alignClass(column.align)}`}>
                        {column.render(item)}
                      </td>
                    ))}
                  </tr>
                  {expanded ? (
                    <tr className="border-b border-border/60 bg-card">
                      <td colSpan={columns.length} className="px-4 pb-4 pt-0">
                        {renderExpanded(item)}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
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
