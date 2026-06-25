import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { AlertHistoryTab } from './AlertHistoryTab'
import * as api from '../api/client'
import type { AlertHistory, Node } from '../types'

vi.mock('../api/client', () => ({
  deleteAlertHistories: vi.fn(),
  deleteAlertHistory: vi.fn(),
  getAlertHistory: vi.fn(),
  resolveAlertHistory: vi.fn()
}))

const nodes: Node[] = [
  {
    id: 'node-1',
    name: 'master',
    hostname: 'master',
    ip: '192.168.98.10',
    os: 'linux',
    arch: 'amd64',
    kernel: '6.6',
    agent_version: '0.1.0',
    status: 'online',
    last_seen_at: '2026-06-25T10:00:00Z'
  }
]

const activeAlert: AlertHistory = {
  id: 7,
  rule_id: 3,
  rule_name: 'CPU High',
  node_id: 'node-1',
  node_name: 'master',
  metric_field: 'cpu_usage',
  metric_value: 95,
  threshold: 80,
  triggered_at: '2026-06-25T10:00:00Z',
  notification_sent: false,
  created_at: '2026-06-25T10:00:00Z'
}

const resolvedAlert: AlertHistory = {
  ...activeAlert,
  id: 8,
  resolved_at: '2026-06-25T10:05:00Z'
}

const secondResolvedAlert: AlertHistory = {
  ...resolvedAlert,
  id: 9,
  rule_name: 'Memory High'
}

const resolveAlertHistoryMock = () =>
  (api as unknown as { resolveAlertHistory: ReturnType<typeof vi.fn> }).resolveAlertHistory
const deleteAlertHistoryMock = () =>
  (api as unknown as { deleteAlertHistory: ReturnType<typeof vi.fn> }).deleteAlertHistory
const deleteAlertHistoriesMock = () =>
  (api as unknown as { deleteAlertHistories: ReturnType<typeof vi.fn> }).deleteAlertHistories

describe('AlertHistoryTab', () => {
  beforeEach(() => {
    vi.mocked(api.getAlertHistory).mockResolvedValue({ history: [activeAlert] })
    resolveAlertHistoryMock().mockResolvedValue({ ...activeAlert, resolved_at: '2026-06-25T10:05:00Z' })
    deleteAlertHistoryMock().mockResolvedValue(undefined)
    deleteAlertHistoriesMock().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('lets active alerts be manually resolved', async () => {
    render(<AlertHistoryTab nodes={nodes} />)

    const resolveButton = await screen.findByRole('button', { name: '标记解决' })
    fireEvent.click(resolveButton)

    await waitFor(() => expect(resolveAlertHistoryMock()).toHaveBeenCalledWith(7))
    await waitFor(() => expect(api.getAlertHistory).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('告警标记解决成功')).toBeInTheDocument()
  })

  test('lets resolved alerts be deleted individually', async () => {
    vi.mocked(api.getAlertHistory)
      .mockResolvedValueOnce({ history: [resolvedAlert] })
      .mockResolvedValueOnce({ history: [] })

    render(<AlertHistoryTab nodes={nodes} />)

    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }))

    await waitFor(() => expect(deleteAlertHistoryMock()).toHaveBeenCalledWith(8))
    await waitFor(() => expect(api.getAlertHistory).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('告警删除成功')).toBeInTheDocument()
  })

  test('lets resolved alerts be selected and deleted in batch', async () => {
    vi.mocked(api.getAlertHistory)
      .mockResolvedValueOnce({ history: [resolvedAlert, secondResolvedAlert] })
      .mockResolvedValueOnce({ history: [] })

    render(<AlertHistoryTab nodes={nodes} />)

    fireEvent.click(await screen.findByRole('button', { name: '已解决' }))
    fireEvent.click(await screen.findByRole('button', { name: '全选当前结果' }))
    fireEvent.click(await screen.findByRole('button', { name: '删除所选' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }))

    await waitFor(() => expect(deleteAlertHistoriesMock()).toHaveBeenCalledWith([8, 9]))
    await waitFor(() => expect(api.getAlertHistory).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('告警批量删除成功')).toBeInTheDocument()
  })

  test('uses the select all button as the clear selection toggle', async () => {
    vi.mocked(api.getAlertHistory).mockResolvedValue({ history: [resolvedAlert, secondResolvedAlert] })

    render(<AlertHistoryTab nodes={nodes} />)

    fireEvent.click(await screen.findByRole('button', { name: '已解决' }))
    expect(screen.queryByRole('button', { name: '清空选择' })).not.toBeInTheDocument()

    const selectAllButton = await screen.findByRole('button', { name: '全选当前结果' })
    const deleteSelectedButton = await screen.findByRole('button', { name: '删除所选' })

    expect(deleteSelectedButton).toBeDisabled()
    fireEvent.click(selectAllButton)
    expect(deleteSelectedButton).not.toBeDisabled()

    fireEvent.click(selectAllButton)
    expect(deleteSelectedButton).toBeDisabled()
  })
})
