import { getSsrEnv } from './ssrEnv.node'
import { assert } from './utils'
import { ViteManifest } from './getViteManifest.node'
import { ModuleNode } from 'vite'
import { getPageFiles } from './page-files/getPageFiles.shared'

export { getPreloadUrls }

async function getPreloadUrls(
  dependencies: string[],
  clientManifest: null | ViteManifest,
  serverManifest: null | ViteManifest
): Promise<string[]> {
  const ssrEnv = getSsrEnv()

  let preloadUrls = new Set<string>()
  if (!ssrEnv.isProduction) {
    const visitedModules = new Set<string>()
    const skipPageViewFiles = (await getPageViewFiles()).filter(
      (pageViewFile) => !dependencies.some((dep) => dep.includes(pageViewFile))
    )
    await Promise.all(
      dependencies.map(async (filePath) => {
        assert(filePath)
        const mod = await ssrEnv.viteDevServer.moduleGraph.getModuleByUrl(filePath)
        collectCss(mod, preloadUrls, visitedModules, skipPageViewFiles)
      })
    )
  } else {
    assert(clientManifest && serverManifest)
    const visistedAssets = new Set<string>()
    dependencies.forEach((filePath) => {
      const modulePath = getModulePath(filePath)
      let manifest: ViteManifest | undefined = undefined
      if (serverManifest[modulePath]) manifest = serverManifest
      if (clientManifest[modulePath]) manifest = clientManifest
      if (!manifest) return // `modulePath` may be missing in the manifest; https://github.com/brillout/vite-plugin-ssr/issues/51
      if (manifest === serverManifest) return // We disable this for now; changes to Vite are required for this to work.
      const onlyCollectStaticAssets = manifest === serverManifest
      collectAssets(modulePath, preloadUrls, visistedAssets, manifest, onlyCollectStaticAssets)
    })
  }

  return Array.from(preloadUrls)
}

async function getPageViewFiles(): Promise<string[]> {
  const files = await getPageFiles('.page')
  const pageViewFiles = files.map(({ filePath }) => filePath)
  return pageViewFiles
}

function collectAssets(
  modulePath: string,
  preloadUrls: Set<string>,
  visistedAssets: Set<string>,
  manifest: ViteManifest,
  onlyCollectStaticAssets: boolean
): void {
  if (visistedAssets.has(modulePath)) return
  visistedAssets.add(modulePath)
  const manifestEntry = manifest[modulePath]
  assert(manifestEntry)

  const { imports = [], assets = [], css = [] } = manifestEntry
  for (const importAsset of imports) {
    const importManifestEntry = manifest[importAsset]
    const { file } = importManifestEntry
    if (!onlyCollectStaticAssets) {
      preloadUrls.add(`/${file}`)
    }
    collectAssets(importAsset, preloadUrls, visistedAssets, manifest, onlyCollectStaticAssets)
  }
  for (const cssAsset of css) {
    preloadUrls.add(`/${cssAsset}`)
  }

  for (const asset of assets) {
    preloadUrls.add(`/${asset}`)
  }
}

function getModulePath(filePath: string): string {
  let modulePath = filePath
  if (modulePath.startsWith('/')) {
    modulePath = modulePath.slice(1)
  }
  return modulePath
}

function collectCss(
  mod: ModuleNode | undefined,
  preloadUrls: Set<string>,
  visitedModules: Set<string>,
  skipPageViewFiles: string[]
): void {
  if (!mod) return
  if (!mod.url) return
  if (skipPageViewFiles.some((pageViewFile) => mod.id && mod.id.includes(pageViewFile))) return
  if (visitedModules.has(mod.url)) return
  visitedModules.add(mod.url)
  if (mod.url.endsWith('.css') || (mod.id && /\?vue&type=style/.test(mod.id))) {
    preloadUrls.add(mod.url)
  }
  mod.importedModules.forEach((dep) => {
    collectCss(dep, preloadUrls, visitedModules, skipPageViewFiles)
  })
}
