import { expect, test } from 'vitest'

import indexHTML from '../index.html?raw'
import faviconSVG from '../public/favicon.svg?raw'
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

test('index uses the MizuPanel svg favicon asset', () => {
  expect(indexHTML).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />')
  expect(faviconSVG).toContain('MizuPanel')
})
