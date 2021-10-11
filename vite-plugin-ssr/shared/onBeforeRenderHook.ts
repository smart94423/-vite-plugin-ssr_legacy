import { isObject, assert, assertUsage, hasProp, isCallable } from './utils'

export { getOnBeforeRenderHook }
export { runOnBeforeRenderHooks }
export type { OnBeforeRenderHook }

type OnBeforeRenderHook = {
  callHook: (pageContext: Record<string, unknown>) => Promise<{ pageContext: Record<string, unknown> }>
  hookWasCalled: boolean
}

function getOnBeforeRenderHook(
  fileExports: Record<string, unknown>,
  filePath: string,
  required: true
): OnBeforeRenderHook
function getOnBeforeRenderHook(fileExports: Record<string, unknown>, filePath: string): null | OnBeforeRenderHook
function getOnBeforeRenderHook(
  fileExports: Record<string, unknown>,
  filePath: string,
  required?: true
): null | OnBeforeRenderHook {
  if (required) {
    assertUsage(hasProp(fileExports, 'onBeforeRender'), `${filePath} should \`export { onBeforeRender }\`.`)
  } else {
    if (!hasProp(fileExports, 'onBeforeRender')) {
      return null
    }
  }
  assertUsage(
    isCallable(fileExports.onBeforeRender),
    `The \`export { onBeforeRender }\` of ${filePath} should be a function.`
  )
  const onBeforeRenderHook = {
    async callHook(pageContext: Record<string, unknown>) {
      assert(onBeforeRenderHook.hookWasCalled === false)
      onBeforeRenderHook.hookWasCalled = true
      assert(isCallable(fileExports.onBeforeRender))
      const hookReturn = await fileExports.onBeforeRender(pageContext)
      if (hookReturn === undefined || hookReturn === null) {
        return { pageContext: {} }
      }
      assertUsage(
        hasProp(hookReturn, 'pageContext'),
        `The \`onBeforeRender()\` hook exported by ${filePath} should return \`undefined\`, \`null\`, or \`{ pageContext: { /*...*/ }}\` (a JavaScript object with a single key \`pageContext\`).`
      )
      const pageContextAddendum = hookReturn.pageContext
      return { pageContext: pageContextAddendum }
    },
    hookWasCalled: false
  }
  return onBeforeRenderHook
}

async function runOnBeforeRenderHooks(
  pageFile: null | {
    onBeforeRenderHook: null | OnBeforeRenderHook
    fileExports: { skipDefaultOnBeforeRenderHook?: boolean }
  },
  defaultFile: null | { onBeforeRenderHook: null | OnBeforeRenderHook },
  pageContextOriginal: { _pageId: string } & Record<string, unknown>
): Promise<{ pageContextAddendum: Record<string, unknown> }> {
  const pageContextAddendum = {}

  if (defaultFile?.onBeforeRenderHook && !pageFile?.fileExports.skipDefaultOnBeforeRenderHook) {
    const hookReturn = await defaultFile.onBeforeRenderHook.callHook({
      ...pageContextOriginal,
      runPageOnBeforeRenderHook
    })
    assert(isObject(hookReturn.pageContext))
    Object.assign(pageContextAddendum, hookReturn.pageContext)
    assertUsage(
      !pageFile?.onBeforeRenderHook || pageFile.onBeforeRenderHook.hookWasCalled,
      `The page \`${pageContextOriginal._pageId}\` has a \`onBeforeRender()\` a hook defined in ${pageFile} +' as well as in ${defaultFile}. Either \`export const skipDefaultOnBeforeRenderHook = true\` in ${pageFile} or call \`const { pageContext: pageContextAddendum } = await pageContext.runPageOnBeforeRenderHook(pageContext)\` in the \`onBeforeRender()\` hook defined in ${defaultFile} — see https://vite-plugin-ssr.com/onBeforeRender`
    )
  } else {
    if (pageFile?.onBeforeRenderHook) {
      const hookReturn = await pageFile.onBeforeRenderHook.callHook(pageContextOriginal)
      assert(isObject(hookReturn.pageContext))
      Object.assign(pageContextAddendum, hookReturn.pageContext)
    }
  }

  assert(!pageFile?.onBeforeRenderHook || pageFile.onBeforeRenderHook.hookWasCalled === true)
  assert(!defaultFile?.onBeforeRenderHook || defaultFile.onBeforeRenderHook.hookWasCalled === true)

  return { pageContextAddendum }

  async function runPageOnBeforeRenderHook(pageContextProvided?: Record<string, unknown>) {
    if (!pageFile?.onBeforeRenderHook) {
      return { pageContext: {} }
    }
    const { onBeforeRenderHook } = pageFile
    assertUsage(
      onBeforeRenderHook.hookWasCalled === false,
      'You already called `pageContext.runPageOnBeforeRenderHook()`; you cannot call it a second time.'
    )
    const hookResult = await onBeforeRenderHook.callHook(pageContextProvided || pageContextOriginal)
    assert('pageContext' in hookResult)
    return hookResult
  }
}
