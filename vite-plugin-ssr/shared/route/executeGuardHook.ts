export { executeGuardHook }

import { getHook, Hook } from '../hooks/getHook.js'
import { assert, assertUsage, executeHook, isCallable } from './utils.js'
import type { PageContextExports, PageFile } from '../getPageFiles.js'
import type { PageConfig } from '../page-configs/PageConfig.js'

async function executeGuardHook<
  T extends PageContextExports & {
    _pageId: string
    _pageFilesAll: PageFile[]
    _pageConfigs: PageConfig[]
  }
>(pageContext: T, prepareForUserConsumption: (pageConfig: T) => T | void): Promise<void> {
  let hook: Hook | null
  if (pageContext._pageFilesAll.length > 0) {
    // V0.4 design
    assert(pageContext._pageConfigs.length === 0)
    hook = findPageGuard(pageContext._pageId, pageContext._pageFilesAll)
  } else {
    // V1 design
    hook = getHook(pageContext, 'guard')
  }

  if (!hook) return
  const guard = hook.hookFn

  let pageContextForUserConsumption = pageContext
  const res = prepareForUserConsumption(pageContext)
  if (res) pageContextForUserConsumption = res

  const hookResult = await executeHook(() => guard(pageContextForUserConsumption), 'guard', hook.hookFilePath)
  assertUsage(
    hookResult === undefined,
    `The guard() hook of ${hook.hookFilePath} returns a value, but guard() doesn't accept any return value`
  )
}

// We cannot easily use pageContext.exports for the V0.4 design
// TODO/v1-release: remove
type PageGuard = Hook
function findPageGuard(pageId: string, pageFilesAll: PageFile[]): null | PageGuard {
  const pageRouteFile = pageFilesAll.find((p) => p.pageId === pageId && p.fileType === '.page.route')
  if (!pageRouteFile) return null
  const { filePath, fileExports } = pageRouteFile
  assert(fileExports) // loadPageRoutes() should already have been called
  const hookFn = fileExports.guard
  if (!hookFn) return null
  const hookFilePath = filePath
  assertUsage(isCallable(hookFn), `guard() defined by ${hookFilePath} should be a function`)
  return { hookFn, hookName: 'guard', hookFilePath }
}
