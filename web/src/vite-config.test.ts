import { expect, test } from 'vitest'

import config from '../vite.config'

test('api proxy preserves browser host for same-origin protected operations', () => {
  const proxy = config.server?.proxy
  const apiProxy = proxy && !Array.isArray(proxy) ? proxy['/api'] : undefined

  expect(apiProxy).toMatchObject({
    target: 'http://localhost:8080',
    changeOrigin: false,
  })
})
