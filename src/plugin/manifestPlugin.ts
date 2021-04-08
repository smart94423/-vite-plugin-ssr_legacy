import { Plugin } from 'vite'
import { assert } from '../utils'
import { isSSR } from './utils'

export { manifestPlugin }

function manifestPlugin(): Plugin {
  let base: string
  let ssr: boolean
  return {
    name: 'vite-plugin-ssr:manifest',
    apply: 'build',
    configResolved(config) {
      base = config.base
      ssr = isSSR(config)
    },
    generateBundle(_, bundle) {
      if (ssr) return
      assert(typeof base === 'string')
      assert(typeof ssr === 'boolean')
      const doesClientSideRouting = includesClientSideRouter(bundle as any)
      const pluginManifest = { doesClientSideRouting, base }
      this.emitFile({
        fileName: `manifest_vite-plugin-ssr.json`,
        type: 'asset',
        source: JSON.stringify(pluginManifest, null, 2)
      })
    }
  } as Plugin
}

function includesClientSideRouter(bundle: Record<string, { modules?: Record<string, unknown> }>) {
  const fileSource = require.resolve('../../client/router/getPageProps.client.ts')
  const fileDist = require.resolve('../client/router/getPageProps.client.js')
  for (const file of Object.keys(bundle)) {
    const bundleFile = bundle[file]
    const modules = bundleFile.modules || {}
    if (fileSource in modules || fileDist in modules) {
      return true
    }
  }
  return false
}
