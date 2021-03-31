import { Plugin, UserConfig } from 'vite'
import {
  isAbsolute as pathIsAbsolute,
  relative as pathRelative,
  basename as pathFilename,
  sep as pathSep,
  posix as pathPosix
} from 'path'
import { assertPatch } from '@brillout/vite-fix-2390'
import { assert, assertUsage } from '../utils/assert'
import * as glob from 'fast-glob'

export { plugin }
export default plugin

function plugin(): Plugin[] {
  const ssr = { external: ['vite-plugin-ssr'] }
  return [
    {
      name: 'vite-plugin-ssr:dev',
      apply: 'serve',
      config: () => ({
        ssr,
        optimizeDeps: {
          entries: [
            '**/*.page.*([a-zA-Z0-9])',
            '**/*.page.client.*([a-zA-Z0-9])'
          ]
        }
      })
    },
    {
      name: 'vite-plugin-ssr:build',
      apply: 'build',
      config: (config) => {
        assertPatch()
        return {
          build: {
            outDir: getOutDir(config),
            manifest: true,
            rollupOptions: { input: entryPoints(config) },
            polyfillDynamicImport: false
          },
          ssr
        }
      }
    },
    (() => {
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
          const usesClientRouter = includesUseClientRouter(bundle as any)
          const pluginManifest = { usesClientRouter, base }
          this.emitFile({
            fileName: `manifest_vite-plugin-ssr.json`,
            type: 'asset',
            source: JSON.stringify(pluginManifest, null, 2)
          })
        }
      } as Plugin
    })()
  ]
}

function includesUseClientRouter(
  bundle: Record<string, { modules?: Record<string, unknown> }>
) {
  const fileSource = require.resolve(
    '../../client/router/useClientRouter.client.ts'
  )
  const fileDist = require.resolve('../client/router/useClientRouter.client.js')
  for (const file of Object.keys(bundle)) {
    const bundleFile = bundle[file]
    const modules = bundleFile.modules || {}
    if (fileSource in modules || fileDist in modules) {
      return true
    }
  }
  return false
}

function entryPoints(config: UserConfig): Record<string, string> {
  if (isSSR(config)) {
    return serverEntryPoints()
  } else {
    return browserEntryPoints(config)
  }
}

function serverEntryPoints(): Record<string, string> {
  const serverEntry = require.resolve('../user-files/infra.node.vite-entry')
  const entryName = pathFilename(serverEntry).replace(/\.js$/, '')
  const entryPoints = {
    [entryName]: serverEntry
  }
  return entryPoints
}

function browserEntryPoints(config: UserConfig): Record<string, string> {
  const root = getRoot(config)
  assert(pathIsAbsolute(root))

  const browserEntries = glob.sync(`${root}/**/*.page.client.*([a-zA-Z0-9])`, {
    ignore: ['**/node_modules/**']
  })

  const entryPoints: Record<string, string> = {}
  for (const filePath of browserEntries) {
    assert(pathIsAbsolute(filePath))
    const outFilePath = pathRelativeToRoot(filePath, config)
    entryPoints[outFilePath] = filePath
  }
  return entryPoints
}

function pathRelativeToRoot(filePath: string, config: UserConfig): string {
  assert(pathIsAbsolute(filePath))
  const root = getRoot(config)
  assert(pathIsAbsolute(root))
  return pathRelative(root, filePath)
}

function isSSR(config: { build?: { ssr?: boolean | string } }): boolean {
  return !!config?.build?.ssr
}

function getRoot(config: UserConfig): string {
  let root = config.root || process.cwd()
  assert(pathIsAbsolute(root))
  root = posixPath(root)
  return root
}

function getOutDir(config: UserConfig): string {
  let outDir = config.build?.outDir
  if (!outDir) {
    outDir = config.build?.ssr ? 'dist/server' : 'dist/client'
  }
  return outDir
}

function posixPath(path: string): string {
  return path.split(pathSep).join(pathPosix.sep)
}

Object.defineProperty(plugin, 'apply', {
  enumerable: true,
  get: () => {
    assertUsage(
      false,
      'Make sure to instantiate the `ssr` plugin (`import ssr from "vite-plugin-ssr"`): include `ssr()` instead of `ssr` in the `plugins` list of your `vite.config.js`.'
    )
  }
})

// Enable `const ssr = require('vite-plugin-ssr/plugin')`
// This lives at the end of the file to ensure it happens after all assignments to `exports`
module.exports = Object.assign(exports.default, exports)
