import { afterEach, describe, expect, test, vi } from 'vitest'

import { createInstallCommand, getNodeMetrics, getNodes } from './client'

describe('api client', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('fetches nodes from the REST API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ nodes: [] })))

    const result = await getNodes()

    expect(fetchMock).toHaveBeenCalledWith('/api/nodes')
    expect(result.nodes).toEqual([])
  })

  test('fetches node metrics with a supported range', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ metrics: [] })))

    await getNodeMetrics('node-1', '6h')

    expect(fetchMock).toHaveBeenCalledWith('/api/nodes/node-1/metrics?range=6h')
  })

  test('creates install commands without a session request header', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ command: 'install', install_token: 'token' })))

    const result = await createInstallCommand()

    expect(fetchMock).toHaveBeenCalledWith('/api/install/command', { method: 'POST' })
    expect(result.command).toBe('install')
  })

  test('marks unauthorized API responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unauthorized', { status: 401 }))

    await expect(createInstallCommand()).rejects.toMatchObject({ status: 401 })
  })

  test('throws when the API response is not ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad', { status: 500 }))

    await expect(getNodes()).rejects.toThrow('Request failed')
  })
})
