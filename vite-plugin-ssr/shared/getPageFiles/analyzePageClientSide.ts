export { analyzePageClientSide }
export { analyzePageClientSideInit }

import { analyzeExports } from './analyzePageClientSide/analyzeExports'
import { determineClientEntry, getVPSClientEntry } from './analyzePageClientSide/determineClientEntry'
import { getPageFilesClientSide } from './getAllPageIdFiles'
import { getPageFilesServerSide } from './getAllPageIdFiles'
import { assert } from '../utils'
import { getExportNames } from './analyzePageClientSide/getExportNames'
import type { PageFile } from './getPageFileObject'
import { ClientDependency } from './analyzePageClientSide/ClientDependency'
import type { PageConfig2 } from '../page-configs/PageConfig'
import { getCodeFilePath, getConfigValue } from '../page-configs/utils'

function analyzePageClientSide(pageFilesAll: PageFile[], pageConfig: null | PageConfig2, pageId: string) {
  if (pageConfig) {
    const isClientRouting = getConfigValue(pageConfig, 'isClientRouting', 'boolean') ?? false
    const clientEntryPageConfig = getCodeFilePath(pageConfig, 'clientEntry')
    const isHtmlOnly = !!clientEntryPageConfig
    const clientEntry = isHtmlOnly ? clientEntryPageConfig : getVPSClientEntry(isClientRouting)
    const clientDependencies: ClientDependency[] = []
    Object.values(pageConfig.configSources).forEach((configSource) => {
      if ('codeFilePath' in configSource) {
        clientDependencies.push({
          id: configSource.codeFilePath,
          onlyAssets: configSource.c_env === 'server-only'
        })
      }
    })
    clientDependencies.push({
      id: clientEntry,
      onlyAssets: false
    })
    const clientEntries: string[] = [clientEntry]
    return {
      isHtmlOnly,
      isClientRouting,
      clientEntries,
      clientDependencies,
      // pageFilesClientSide and pageFilesServerSide are only used for debugging
      pageFilesClientSide: [],
      pageFilesServerSide: []
    }
  }

  let pageFilesClientSide = getPageFilesClientSide(pageFilesAll, pageId)
  const pageFilesServerSide = getPageFilesServerSide(pageFilesAll, pageId)
  const { isHtmlOnly, isClientRouting } = analyzeExports({ pageFilesClientSide, pageFilesServerSide, pageId })

  if (isHtmlOnly) {
    // HTML-only pages don't need any client-side `render()` hook. For apps that have both HTML-only and SSR/SPA pages, we skip the `.page.client.js` file that defines `render()` for HTML-only pages.
    pageFilesClientSide = pageFilesClientSide.filter(
      (p) => p.isEnv('CLIENT_ONLY') && !getExportNames(p).includes('render')
    )
    pageFilesClientSide = removeOverridenPageFiles(pageFilesClientSide)
  }

  const { clientEntries, clientDependencies } = determineClientEntry({
    pageFilesClientSide,
    pageFilesServerSide,
    isHtmlOnly,
    isClientRouting
  })
  return { isHtmlOnly, isClientRouting, clientEntries, clientDependencies, pageFilesClientSide, pageFilesServerSide }
}

async function analyzePageClientSideInit(
  pageFilesAll: PageFile[],
  pageId: string,
  { sharedPageFilesAlreadyLoaded }: { sharedPageFilesAlreadyLoaded: boolean }
) {
  const pageFilesClientSide = getPageFilesClientSide(pageFilesAll, pageId)

  await Promise.all(
    pageFilesClientSide.map(async (p) => {
      assert(p.isEnv('CLIENT_ONLY') || p.isEnv('CLIENT_AND_SERVER'))
      if (sharedPageFilesAlreadyLoaded && p.isEnv('CLIENT_AND_SERVER')) {
        return
      }
      // TODO: Is `loadExportNames()` cached ? Does it use filesExports if possible? HMR?
      await p.loadExportNames?.()
      /*
      if (pageFile.exportNames) {
        return pageFile.exportNames.includes(clientRouting)
      }
      if (pageFile.fileExports) {
        return Object.keys(pageFile.fileExports).includes(clientRouting)
      }
      */
    })
  )
}

// [WIP] Just an experiment needed by https://vite-plugin-ssr.com/banner
//  - Not sure I want to make something like a public API: the CSS of `_default.page.server.js` are still loaded -> weird DX.
function removeOverridenPageFiles(pageFilesClientSide: PageFile[]) {
  const pageFilesClientSide_: PageFile[] = []
  for (const p of pageFilesClientSide) {
    pageFilesClientSide_.push(p)
    if (getExportNames(p).includes('overrideDefaultPages')) {
      break
    }
  }
  return pageFilesClientSide_
}
