import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { K8sResourceTable } from './K8sResourceTable'

describe('K8sResourceTable soft styling', () => {
  test('uses the shared soft table surface for populated lists', () => {
    render(
      <K8sResourceTable
        items={[{ name: 'nginx' }]}
        getKey={(item) => item.name}
        emptyText="暂无资源"
        columns={[{ key: 'name', title: '名称', render: (item) => item.name }]}
      />
    )

    expect(screen.getByRole('table').parentElement?.parentElement).toHaveClass('soft-table')
  })

  test('uses the shared soft empty surface for empty lists', () => {
    render(
      <K8sResourceTable
        items={[]}
        getKey={(item: { name: string }) => item.name}
        emptyText="暂无资源"
        columns={[{ key: 'name', title: '名称', render: (item: { name: string }) => item.name }]}
      />
    )

    expect(screen.getByText('暂无资源').parentElement).toHaveClass('soft-empty-state')
  })
})
