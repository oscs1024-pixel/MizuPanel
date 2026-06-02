import { expect, test } from 'vitest'

import config from '../vite.config'

test('api proxy preserves browser host for same-origin protected operations', () => {
  const proxy = config.server?.proxy
  const apiProxy = proxy && !Array.isArray(proxy) ? proxy['/api'] : undefined

  expect(apiProxy).toMatchObject({
    target: 'http://localhost:8080',
    changeOrigin: false,
    ws: true,
  })
})

test('dev proxy serves backend script and download assets used by SSH install', () => {
  const proxy = config.server?.proxy
  const scriptProxy = proxy && !Array.isArray(proxy) ? proxy['/scripts'] : undefined
  const downloadProxy = proxy && !Array.isArray(proxy) ? proxy['/downloads'] : undefined

  expect(scriptProxy).toMatchObject({ target: 'http://localhost:8080', changeOrigin: false })
  expect(downloadProxy).toMatchObject({ target: 'http://localhost:8080', changeOrigin: false })
})
