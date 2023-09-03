export { loadPageRoutes }
export type { PageRoutes }
export type { RouteType }

import type { PageFile } from '../getPageFiles.js'
import { isErrorPageId } from '../error-page.js'
import { assert, assertUsage, hasProp, slice } from './utils.js'
import type { OnBeforeRouteHook } from './executeOnBeforeRouteHook.js'
import { FilesystemRoot, deduceRouteStringFromFilesystemPath } from './deduceRouteStringFromFilesystemPath.js'
import { isCallable } from '../utils.js'
import type { PageConfig, PageConfigGlobal } from '../page-configs/PageConfig.js'
import { getConfigValue, getConfigSrc } from '../page-configs/utils.js'
import { warnDeprecatedAllowKey } from './resolveRouteFunction.js'

type PageRoute = {
  pageId: string
  comesFromV1PageConfig: boolean
} & (
  | { routeString: string; routeDefinedAt: null; routeType: 'FILESYSTEM'; routeFilesystemDefinedBy: string }
  | { routeString: string; routeDefinedAt: string; routeType: 'STRING' }
  | { routeFunction: Function; routeDefinedAt: string; routeType: 'FUNCTION' }
)
type PageRoutes = PageRoute[]
type RouteType = 'STRING' | 'FUNCTION' | 'FILESYSTEM'

async function loadPageRoutes(
  // TODO: remove all arguments and use GlobalContext instead
  pageFilesAll: PageFile[],
  pageConfigs: PageConfig[],
  pageConfigGlobal: PageConfigGlobal,
  allPageIds: string[]
): Promise<{ pageRoutes: PageRoutes; onBeforeRouteHook: null | OnBeforeRouteHook }> {
  await Promise.all(pageFilesAll.filter((p) => p.fileType === '.page.route').map((p) => p.loadFile?.()))
  const { onBeforeRouteHook, filesystemRoots } = getGlobalHooks(pageFilesAll, pageConfigs, pageConfigGlobal)
  const pageRoutes = getPageRoutes(filesystemRoots, pageFilesAll, pageConfigs, allPageIds)
  return { pageRoutes, onBeforeRouteHook }
}

function getPageRoutes(
  filesystemRoots: null | FilesystemRoot[],
  pageFilesAll: PageFile[],
  pageConfigs: PageConfig[],
  allPageIds: string[]
): PageRoutes {
  const pageRoutes: PageRoutes = []

  let pageIds = [...allPageIds]

  // V1 Design
  if (pageConfigs.length > 0) {
    assert(filesystemRoots === null)
    const comesFromV1PageConfig = true
    pageConfigs
      .filter((p) => !p.isErrorPage)
      .forEach((pageConfig) => {
        const pageId = pageConfig.pageId
        pageIds = removePageId(pageIds, pageId)

        let pageRoute: null | PageRoute = null
        {
          const routeConfig = pageConfig.configValues.route
          if (routeConfig) {
            const route = routeConfig.value
            const configSrc = getConfigSrc(routeConfig)
            assert(configSrc)
            if (typeof route === 'string') {
              pageRoute = {
                pageId,
                comesFromV1PageConfig,
                routeString: route,
                routeDefinedAt: configSrc,
                routeType: 'STRING'
              }
            } else {
              assert(isCallable(route))
              {
                const val = getConfigValue(pageConfig, 'iKnowThePerformanceRisksOfAsyncRouteFunctions', 'boolean')
                if (val !== null) warnDeprecatedAllowKey()
              }
              pageRoute = {
                pageId,
                comesFromV1PageConfig,
                routeFunction: route,
                routeDefinedAt: configSrc,
                routeType: 'FUNCTION'
              }
            }
          }
        }

        if (!pageRoute) {
          const { routeFilesystem, routeFilesystemDefinedBy } = pageConfig
          assert(routeFilesystem)
          assert(routeFilesystem.startsWith('/'))
          assert(routeFilesystemDefinedBy)
          pageRoute = {
            pageId,
            routeFilesystemDefinedBy,
            comesFromV1PageConfig,
            routeString: routeFilesystem,
            routeDefinedAt: null,
            routeType: 'FILESYSTEM'
          }
        }

        assert(pageRoute)
        pageRoutes.push(pageRoute)
      })
  }

  // Old design
  // TODO/v1-release: remove
  if (pageConfigs.length === 0) {
    assert(filesystemRoots)
    const comesFromV1PageConfig = false
    pageIds
      .filter((pageId) => !isErrorPageId(pageId, false))
      .forEach((pageId) => {
        const pageRouteFile = pageFilesAll.find((p) => p.pageId === pageId && p.fileType === '.page.route')
        if (!pageRouteFile || !('default' in pageRouteFile.fileExports!)) {
          const routeString = deduceRouteStringFromFilesystemPath(pageId, filesystemRoots)
          assert(routeString.startsWith('/'))
          assert(!routeString.endsWith('/') || routeString === '/')
          pageRoutes.push({
            pageId,
            comesFromV1PageConfig,
            routeString,
            routeDefinedAt: null,
            routeFilesystemDefinedBy: `${pageId}.page.*`,
            routeType: 'FILESYSTEM'
          })
        } else {
          const { filePath, fileExports } = pageRouteFile
          assert(fileExports.default)
          if (hasProp(fileExports, 'default', 'string')) {
            const routeString = fileExports.default
            assertUsage(
              routeString.startsWith('/'),
              `A Route String should start with a leading slash '/' but ${filePath} has \`export default '${routeString}'\`. Make sure to \`export default '/${routeString}'\` instead.`
            )
            pageRoutes.push({
              pageId,
              comesFromV1PageConfig,
              routeString,
              routeDefinedAt: filePath,
              routeType: 'STRING'
            })
            return
          }
          if (hasProp(fileExports, 'default', 'function')) {
            const routeFunction = fileExports.default
            {
              const allowKey = 'iKnowThePerformanceRisksOfAsyncRouteFunctions'
              if (allowKey in fileExports) {
                warnDeprecatedAllowKey()
              }
            }
            pageRoutes.push({
              pageId,
              comesFromV1PageConfig,
              routeFunction,
              routeDefinedAt: filePath,
              routeType: 'FUNCTION'
            })
            return
          }
          assertUsage(false, `The default export of ${filePath} should be a string or a function.`)
        }
      })
  }

  return pageRoutes
}

function getGlobalHooks(
  pageFilesAll: PageFile[],
  pageConfigs: PageConfig[],
  pageConfigGlobal: PageConfigGlobal
): {
  onBeforeRouteHook: null | OnBeforeRouteHook
  filesystemRoots: null | FilesystemRoot[]
} {
  // V1 Design
  if (pageConfigs.length > 0) {
    if (pageConfigGlobal.onBeforeRoute) {
      const hookFn = pageConfigGlobal.onBeforeRoute.value
      if (hookFn) {
        const hookFilePath = pageConfigGlobal.onBeforeRoute.definedAt.filePath
        assert(hookFilePath)
        assertUsage(isCallable(hookFn), `The hook onBeforeRoute() defined by ${hookFilePath} should be a function.`)
        const onBeforeRouteHook: OnBeforeRouteHook = {
          hookFilePath: hookFilePath,
          onBeforeRoute: hookFn
        }
        return { onBeforeRouteHook, filesystemRoots: null }
      }
    }
    return { onBeforeRouteHook: null, filesystemRoots: null }
  }

  // Old design
  // TODO/v1-release: remove
  let onBeforeRouteHook: null | OnBeforeRouteHook = null
  const filesystemRoots: FilesystemRoot[] = []
  pageFilesAll
    .filter((p) => p.fileType === '.page.route' && p.isDefaultPageFile)
    .forEach(({ filePath, fileExports }) => {
      assert(fileExports)
      if ('onBeforeRoute' in fileExports) {
        assertUsage(
          hasProp(fileExports, 'onBeforeRoute', 'function'),
          `\`export { onBeforeRoute }\` of ${filePath} should be a function.`
        )
        const { onBeforeRoute } = fileExports
        onBeforeRouteHook = { hookFilePath: `${filePath} > \`export { onBeforeRoute }\``, onBeforeRoute }
      }
      if ('filesystemRoutingRoot' in fileExports) {
        assertUsage(
          hasProp(fileExports, 'filesystemRoutingRoot', 'string'),
          `\`export { filesystemRoutingRoot }\` of ${filePath} should be a string.`
        )
        assertUsage(
          hasProp(fileExports, 'filesystemRoutingRoot', 'string'),
          `\`export { filesystemRoutingRoot }\` of ${filePath} is \`'${fileExports.filesystemRoutingRoot}'\` but it should start with a leading slash \`/\`.`
        )
        filesystemRoots.push({
          filesystemRoot: dirname(filePath),
          urlRoot: fileExports.filesystemRoutingRoot
        })
      }
    })

  return { onBeforeRouteHook, filesystemRoots }
}

function dirname(filePath: string): string {
  assert(filePath.startsWith('/'))
  assert(!filePath.endsWith('/'))
  const paths = filePath.split('/')
  const dirPath = slice(paths, 0, -1).join('/') || '/'
  assert(dirPath.startsWith('/'))
  assert(!dirPath.endsWith('/') || dirPath === '/')
  return dirPath
}

function removePageId(pageIds: string[], pageId: string): string[] {
  const { length } = pageIds
  pageIds = pageIds.filter((id) => id !== pageId)
  assert(pageIds.length === length - 1)
  return pageIds
}
