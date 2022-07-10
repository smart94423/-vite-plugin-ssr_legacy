import { navigationState } from '../navigationState'
import {
  assert,
  assertUsage,
  assertWarning,
  getFileUrl,
  hasProp,
  isPlainObject,
  objectAssign,
  getProjectError,
} from './utils'
import { parse } from '@brillout/json-s/parse'
import { getPageContextSerializedInHtml } from '../getPageContextSerializedInHtml'
import { loadPageFiles, PageContextExports, PageFile } from '../../shared/getPageFiles'
import type { PageContextUrls } from '../../shared/addComputedUrlProps'
import { assertHookResult } from '../../shared/assertHookResult'
import { PageContextForRoute, route } from '../../shared/route'
import { getHook } from '../../shared/getHook'
import { releasePageContext } from '../releasePageContext'

export { getPageContext }

type PageContextAddendum = {
  _pageId: string
  _pageContextRetrievedFromServer: null | Record<string, unknown>
  isHydration: boolean
  _comesDirectlyFromServer: boolean
} & PageContextExports

async function getPageContext(
  pageContext: {
    _isFirstRender: boolean
  } & PageContextUrls &
    PageContextForRoute,
): Promise<PageContextAddendum> {
  if (pageContext._isFirstRender && navigationState.isOriginalUrl(pageContext.url)) {
    const pageContextAddendum = await getPageContextFirstRender(pageContext)
    return pageContextAddendum
  } else {
    const pageContextAddendum = await getPageContextPageNavigation(pageContext)
    return pageContextAddendum
  }
}

async function getPageContextFirstRender(pageContext: { _pageFilesAll: PageFile[] }) {
  const pageContextAddendum = getPageContextSerializedInHtml()

  removeBuiltInOverrides(pageContextAddendum)

  const pageContextAddendum2 = await loadPageFiles(pageContext._pageFilesAll, pageContextAddendum._pageId, true)
  objectAssign(pageContextAddendum, pageContextAddendum2)

  objectAssign(pageContextAddendum, {
    isHydration: true,
    _comesDirectlyFromServer: true,
  })

  return pageContextAddendum
}

async function getPageContextPageNavigation(pageContext: PageContextForRoute): Promise<PageContextAddendum> {
  const pageContextAddendum = {
    isHydration: false,
  }
  objectAssign(pageContextAddendum, await getPageContextFromRoute(pageContext))
  objectAssign(pageContextAddendum, await loadPageFiles(pageContext._pageFilesAll, pageContextAddendum._pageId, true))
  objectAssign(pageContextAddendum, await onBeforeRenderExecute({ ...pageContext, ...pageContextAddendum }))
  assert([true, false].includes(pageContextAddendum._comesDirectlyFromServer))
  return pageContextAddendum
}

async function onBeforeRenderExecute(
  pageContext: {
    _pageId: string
    url: string
    isHydration: boolean
    _pageFilesAll: PageFile[]
  } & PageContextExports,
) {
  // `export { onBeforeRender }` defined in `.page.client.js`
  const hook = getHook(pageContext, 'onBeforeRender')
  if (hook) {
    const onBeforeRender = hook.hook
    const pageContextAddendum = {
      _comesDirectlyFromServer: false,
      _pageContextRetrievedFromServer: null,
    }
    const pageContextReadyForRelease = releasePageContext({
      ...pageContext,
      ...pageContextAddendum,
    })
    const hookResult = await onBeforeRender(pageContextReadyForRelease)
    assertHookResult(hookResult, 'onBeforeRender', ['pageContext'], hook.filePath)
    const pageContextFromHook = hookResult?.pageContext
    objectAssign(pageContextAddendum, pageContextFromHook)
    return pageContextAddendum
  }

  // `export { onBeforeRender }` defined in `.page.server.js`
  else if (await hasOnBeforeRenderServerSide(pageContext)) {
    const pageContextFromServer = await retrievePageContextFromServer(pageContext)
    const pageContextAddendum = {}
    Object.assign(pageContextAddendum, pageContextFromServer)
    objectAssign(pageContextAddendum, {
      _comesDirectlyFromServer: true,
      _pageContextRetrievedFromServer: pageContextFromServer,
    })
    return pageContextAddendum
  }

  // No `export { onBeforeRender }` defined
  const pageContextAddendum = { _comesDirectlyFromServer: false, _pageContextRetrievedFromServer: null }
  return pageContextAddendum
}

async function getPageContextFromRoute(
  pageContext: PageContextForRoute,
): Promise<{ _pageId: string; routeParams: Record<string, string> }> {
  const routeResult = await route(pageContext)
  if ('hookError' in routeResult) {
    throw routeResult.hookError
  }
  const pageContextFromRoute = routeResult.pageContextAddendum
  if (pageContextFromRoute._pageId === null) {
    setTimeout(() => {
      handle404(pageContext)
    }, 0)
    assertUsage(
      false,
      `[404] Page ${pageContext.url} does not exist. (\`vite-plugin-ssr\` will now server-side route to \`${pageContext.url}\`.)`,
    )
  } else {
    assert(hasProp(pageContextFromRoute, '_pageId', 'string'))
  }
  return pageContextFromRoute
}

function handle404(pageContext: { url: string }) {
  // We let the server show the 404 page; the server will show the 404 URL against the list of routes.
  window.location.pathname = pageContext.url
}

async function hasOnBeforeRenderServerSide(pageContext: {
  _pageId: string
  _pageFilesAll: PageFile[]
}): Promise<boolean> {
  const pageFilesServerMeta = pageContext._pageFilesAll.filter(
    (p) => p.fileType === '.page.server' && p.isRelevant(pageContext._pageId),
  )
  await Promise.all(pageFilesServerMeta.map((p) => p.loadExportNames?.()))
  return pageFilesServerMeta.some(({ meta }) => {
    assert(hasProp(meta, 'exportNames', 'string[]'))
    assert(Object.keys(meta).length === 1)
    return meta.exportNames.includes('onBeforeRender')
  })
}
async function retrievePageContextFromServer(pageContext: { url: string }): Promise<Record<string, unknown>> {
  const pageContextUrl = getFileUrl(pageContext.url, '.pageContext.json', true)
  const response = await fetch(pageContextUrl)

  // Static hosts return a 404
  assert(response.status !== 404)

  {
    const contentType = response.headers.get('content-type')
    assertUsage(
      contentType && contentType.includes('application/json'),
      `Wrong HTTP Response Header \`content-type\` value for URL ${pageContextUrl} (it should be \`application/json\` but we got \`${contentType}\`). Make sure to use \`pageContext.httpResponse.contentType\`, see https://github.com/brillout/vite-plugin-ssr/issues/191`,
    )
  }

  const responseText = await response.text()
  const responseObject = parse(responseText) as { pageContext: Record<string, unknown> } | { serverSideError: true }
  assert(!('pageContext404PageDoesNotExist' in responseObject))
  if ('serverSideError' in responseObject) {
    throw getProjectError(
      '`pageContext` could not be fetched from the server as an error occurred on the server; check your server logs.',
    )
  }

  assert(hasProp(responseObject, 'pageContext'))
  const pageContextFromServer = responseObject.pageContext
  assert(isPlainObject(pageContextFromServer))
  assert(hasProp(pageContextFromServer, '_pageId', 'string'))

  removeBuiltInOverrides(pageContextFromServer)

  return pageContextFromServer
}

const BUILT_IN_CLIENT_ROUTER = ['urlPathname', 'urlParsed'] as const
const BUILT_IN_CLIENT = ['Page', 'pageExports', 'exports'] as const
type DeletedKeys = typeof BUILT_IN_CLIENT[number] | typeof BUILT_IN_CLIENT_ROUTER[number]
function removeBuiltInOverrides(pageContext: Record<string, unknown> & { [key in DeletedKeys]?: never }) {
  const alreadySet = [...BUILT_IN_CLIENT, ...BUILT_IN_CLIENT_ROUTER]
  alreadySet.forEach((prop) => {
    if (prop in pageContext) {
      // We need to cast `BUILT_IN_CLIENT` to `string[]`
      //  - https://stackoverflow.com/questions/56565528/typescript-const-assertions-how-to-use-array-prototype-includes
      //  - https://stackoverflow.com/questions/57646355/check-if-string-is-included-in-readonlyarray-in-typescript
      if ((BUILT_IN_CLIENT_ROUTER as any as string[]).includes(prop)) {
        assert(prop.startsWith('url'))
        assertWarning(
          false,
          `\`pageContext.${prop}\` is already available in the browser when using \`useClientRouter()\`; including \`${prop}\` in \`passToClient\` has no effect.`,
          { onlyOnce: true },
        )
      } else {
        assertWarning(
          false,
          `\`pageContext.${prop}\` is a built-in that cannot be overriden; including \`${prop}\` in \`passToClient\` has no effect.`,
          { onlyOnce: true },
        )
      }
      delete pageContext[prop]
    }
  })
}
