import { getErrorPageId, route, isErrorPage } from '../shared/route'
import { HtmlRender, isDocumentHtml, renderHtml, getHtmlString } from './html/renderHtml'
import {
  PageFile,
  PageContextExports,
  getExportUnion,
  getPageFilesAllServerSide,
  ExportsAll,
} from '../shared/getPageFiles'
import { analyzePageClientSide, analyzePageClientSideInit } from '../shared/getPageFiles/analyzePageClientSide'
import { getHook } from '../shared/getHook'
import { stringify } from '@brillout/json-s/stringify'
import pc from 'picocolors'
import {
  assert,
  assertUsage,
  assertWarning,
  hasProp,
  isPlainObject,
  isObject,
  objectAssign,
  PromiseType,
  isParsable,
  isPromise,
  handlePageContextRequestSuffix,
  parseUrl,
  createDebugger,
  makeFirst,
} from './utils'
import type { PageAsset } from './html/injectAssets'
import { getPageAssets } from './renderPage/getPageAssets'
import { sortPageContext } from '../shared/sortPageContext'
import { assertHookResult, assertObjectKeys } from '../shared/assertHookResult'
import {
  getStreamReadableNode,
  getStreamReadableWeb,
  pipeToStreamWritableWeb,
  pipeToStreamWritableNode,
  StreamPipeNode,
  StreamPipeWeb,
  StreamReadableNode,
  StreamReadableWeb,
  StreamWritableNode,
  StreamWritableWeb,
  isStream,
  getStreamName,
  inferStreamName,
  isStreamWritableWeb,
  isStreamWritableNode,
} from './html/stream'
import { addIs404ToPageProps, serializePageContextClientSide } from './serializePageContextClientSide'
import { addComputedUrlProps, PageContextUrls } from '../shared/addComputedUrlProps'
import { assertPageContextProvidedByUser } from '../shared/assertPageContextProvidedByUser'
import { isRenderErrorPage, assertRenderErrorPageParentheses } from './renderPage/RenderErrorPage'
import { warn404 } from './renderPage/warn404'
import { getGlobalContext, GlobalContext } from './globalContext'
import { viteAlreadyLoggedError, viteErrorCleanup } from './viteLogging'
import type { ViteDevServer } from 'vite'
import { ViteManifest } from './viteManifest'
import type { ClientDependency } from '../shared/getPageFiles/analyzePageClientSide/ClientDependency'
import { loadPageFilesServerSide } from '../shared/getPageFiles/analyzePageServerSide/loadPageFilesServerSide'

export { renderPage }
export { prerenderPage }
export { renderStatic404Page }
export { loadPageFilesServer }

type PageFiles = PromiseType<ReturnType<typeof loadPageFilesServer>>

type GlobalRenderingContext = GlobalContext & {
  _allPageIds: string[]
  _pageFilesAll: PageFile[]
}

async function renderPage_<PageContextAdded extends {}, PageContextInit extends { url: string }>(
  pageContextInit: PageContextInit,
): Promise<
  PageContextInit & { errorWhileRendering: unknown } & (
      | ({ httpResponse: HttpResponse } & PageContextAdded)
      | ({ httpResponse: null } & Partial<PageContextAdded>)
    )
> {
  assertArguments(...arguments)

  const pageContext = await initializePageContext(pageContextInit)

  if ('httpResponse' in pageContext) {
    assert(pageContext.httpResponse === null)
    return pageContext
  }

  // *** Route ***
  const routeResult = await route(pageContext)
  if ('hookError' in routeResult) {
    const err = routeResult.hookError
    logError(err)
    return await renderErrorPage(pageContextInit, routeResult.hookError)
  }
  objectAssign(pageContext, routeResult.pageContextAddendum)

  // *** Handle 404 ***
  let statusCode: 200 | 404
  if (hasProp(pageContext, '_pageId', 'string')) {
    statusCode = 200
  } else {
    assert(pageContext._pageId === null)
    warn404(pageContext)

    if (!pageContext._isPageContextRequest) {
      statusCode = 404
    } else {
      statusCode = 200
    }

    const errorWhileRendering = null

    // No `_error.page.js` is defined
    const errorPageId = getErrorPageId(pageContext._allPageIds)
    if (!errorPageId) {
      warnMissingErrorPage(pageContext)
      if (pageContext._isPageContextRequest) {
        const httpResponse = createHttpResponseObject(
          stringify({
            pageContext404PageDoesNotExist: true,
          }),
          {
            statusCode,
            renderFilePath: null,
          },
          pageContext,
        )
        objectAssign(pageContext, { httpResponse, errorWhileRendering })
        return pageContext
      } else {
        const httpResponse = null
        objectAssign(pageContext, { httpResponse, errorWhileRendering })
        return pageContext
      }
    }

    // Render 404 page
    objectAssign(pageContext, {
      _pageId: errorPageId,
      is404: true,
      errorWhileRendering,
    })
  }

  const pageFiles = await loadPageFilesServer(pageContext)
  objectAssign(pageContext, pageFiles)

  await executeOnBeforeRenderHooks(pageContext)

  if (pageContext._isPageContextRequest) {
    const pageContextSerialized = serializePageContextClientSide(pageContext)
    const httpResponse = createHttpResponseObject(
      pageContextSerialized,
      { statusCode: 200, renderFilePath: null },
      pageContext,
    )
    objectAssign(pageContext, { httpResponse, errorWhileRendering: null })
    return pageContext
  }

  const renderHookResult = await executeRenderHook(pageContext)

  if (renderHookResult.htmlRender === null) {
    objectAssign(pageContext, { httpResponse: null, errorWhileRendering: null })
    return pageContext
  } else {
    const { htmlRender, renderFilePath } = renderHookResult
    const httpResponse = createHttpResponseObject(htmlRender, { statusCode, renderFilePath }, pageContext)
    objectAssign(pageContext, { httpResponse, errorWhileRendering: null })
    return pageContext
  }
}

async function initializePageContext<PageContextInit extends { url: string }>(pageContextInit: PageContextInit) {
  const pageContext = {
    _isPreRendering: false as const,
    ...pageContextInit,
  }

  if (pageContext.url.endsWith('/favicon.ico') || !isParsable(pageContext.url)) {
    objectAssign(pageContext, { httpResponse: null, errorWhileRendering: null })
    return pageContext
  }

  const globalContext = await getGlobalContext(pageContext._isPreRendering)
  objectAssign(pageContext, globalContext)

  {
    const { pageFilesAll, allPageIds } = await getPageFilesAllServerSide(globalContext._isProduction)
    objectAssign(pageContext, {
      _pageFilesAll: pageFilesAll,
      _allPageIds: allPageIds,
    })
  }

  {
    const { url } = pageContext
    assert(url.startsWith('/') || url.startsWith('http'))
    const { urlWithoutPageContextRequestSuffix, isPageContextRequest } = handlePageContextRequestSuffix(url)
    const { hasBaseUrl } = parseUrl(urlWithoutPageContextRequestSuffix, globalContext._baseUrl)
    if (!hasBaseUrl) {
      objectAssign(pageContext, { httpResponse: null, errorWhileRendering: null })
      return pageContext
    }
    objectAssign(pageContext, {
      _isPageContextRequest: isPageContextRequest,
      _urlProcessor: (url: string) => handlePageContextRequestSuffix(url).urlWithoutPageContextRequestSuffix,
    })
  }

  addComputedUrlProps(pageContext)

  return pageContext
}

// `renderPage()` calls `renderPage_()` while ensuring an `err` is always `console.error(err)` instead of `throw err`, so that `vite-plugin-ssr` never triggers a server shut down. (Throwing an error in an Express.js middleware shuts down the whole Express.js server.)
async function renderPage(pageContextInit: Parameters<typeof renderPage_>[0]): ReturnType<typeof renderPage_> {
  const args = arguments as any as Parameters<typeof renderPage>
  try {
    return await renderPage_.apply(null, args)
  } catch (err) {
    assertError(err)
    const skipLog = isRenderErrorPage(err)
    if (!skipLog) {
      logError(err)
    } else {
      setAlreadyLogged(err)
    }
    try {
      const pageContextAddendum = {}
      if (isRenderErrorPage(err)) {
        objectAssign(pageContextAddendum, { is404: true })
        objectAssign(pageContextAddendum, err.pageContext)
      }
      return await renderErrorPage(pageContextInit, err, pageContextAddendum)
    } catch (err2) {
      assertError(err2)
      // We swallow `err2`; logging `err` should be enough; `err2` is likely the same error than `err` anyways.
      if (skipLog) {
        logError(err2)
      }
      const pageContext = {}
      objectAssign(pageContext, pageContextInit)
      objectAssign(pageContext, {
        httpResponse: null,
        errorWhileRendering: err,
      })
      return pageContext
    }
  }
}

async function renderErrorPage<PageContextInit extends { url: string }>(
  pageContextInit: PageContextInit,
  err: unknown,
  pageContextAddendum?: Record<string, unknown>,
) {
  assert(hasAlreadyLogged(err))

  const pageContext = await initializePageContext(pageContextInit)
  // `pageContext.httpResponse===null` should have already been handled in `renderPage()`
  assert(!('httpResponse' in pageContext))

  objectAssign(pageContext, {
    is404: false,
    errorWhileRendering: err,
    httpResponse: null,
    routeParams: {} as Record<string, string>,
  })

  objectAssign(pageContext, pageContextAddendum)

  const statusCode = pageContext.is404 ? 404 : 500

  if (pageContext._isPageContextRequest) {
    const body = stringify({
      serverSideError: true,
    })
    const httpResponse = createHttpResponseObject(body, { statusCode, renderFilePath: null }, pageContext)
    objectAssign(pageContext, { httpResponse })
    return pageContext
  }

  const errorPageId = getErrorPageId(pageContext._allPageIds)
  if (errorPageId === null) {
    warnMissingErrorPage(pageContext)
    return pageContext
  }
  objectAssign(pageContext, {
    _pageId: errorPageId,
  })

  const pageFiles = await loadPageFilesServer(pageContext)
  objectAssign(pageContext, pageFiles)

  await executeOnBeforeRenderHooks(pageContext)
  const renderHookResult = await executeRenderHook(pageContext)

  const { htmlRender, renderFilePath } = renderHookResult
  const httpResponse = createHttpResponseObject(htmlRender, { statusCode, renderFilePath }, pageContext)
  objectAssign(pageContext, { httpResponse })
  return pageContext
}

function assertError(err: unknown) {
  assertRenderErrorPageParentheses(err)
}

type StatusCode = 200 | 404 | 500
type ContentType = 'application/json' | 'text/html'
type HttpResponse = {
  statusCode: StatusCode
  contentType: ContentType
  body: string
  getBody: () => Promise<string>
  getReadableWebStream: () => StreamReadableWeb
  pipe: (writable: StreamWritableWeb | StreamWritableNode) => void
  // outdated
  getNodeStream: () => Promise<StreamReadableNode>
  getWebStream: () => StreamReadableWeb
  pipeToNodeWritable: StreamPipeNode
  pipeToWebWritable: StreamPipeWeb
}
function createHttpResponseObject(
  htmlRender: null | HtmlRender,
  { statusCode, renderFilePath }: { statusCode: StatusCode; renderFilePath: null | string },
  pageContext: { _isPageContextRequest: boolean },
): HttpResponse | null {
  if (htmlRender === null) {
    return null
  }

  assert(!pageContext._isPageContextRequest || typeof htmlRender === 'string')

  const streamDocs = 'https://vite-plugin-ssr.com/stream'

  return {
    statusCode,
    contentType: pageContext._isPageContextRequest ? 'application/json' : 'text/html',
    get body() {
      if (typeof htmlRender !== 'string') {
        assert(renderFilePath)
        assertUsage(false, errMsg('body', 'Use `const body = await pageContext.httpResponse.getBody()` instead.'))
      }
      const body = htmlRender
      return body
    },
    async getBody(): Promise<string> {
      const body = await getHtmlString(htmlRender)
      return body
    },
    async getNodeStream() {
      assertWarning(
        false,
        '`pageContext.httpResponse.getNodeStream()` is outdated, use `pageContext.httpResponse.pipe()` instead. See ' +
          streamDocs,
        { onlyOnce: true },
      )
      const nodeStream = await getStreamReadableNode(htmlRender)
      assertUsage(nodeStream !== null, errMsg('getNodeStream()', fixMsg('readable', 'node')))
      return nodeStream
    },
    getWebStream() {
      assertWarning(
        false,
        '`pageContext.httpResponse.getWebStream(res)` is outdated, use `pageContext.httpResponse.getReadableWebStream(res)` instead. See ' +
          streamDocs,
        { onlyOnce: true },
      )
      const webStream = getStreamReadableWeb(htmlRender)
      assertUsage(webStream !== null, errMsg('getWebStream()', fixMsg('readable', 'web')))
      return webStream
    },
    getReadableWebStream() {
      const webStream = getStreamReadableWeb(htmlRender)
      assertUsage(webStream !== null, errMsg('getReadableWebStream()', fixMsg('readable', 'web')))
      return webStream
    },
    pipeToWebWritable(writable: StreamWritableWeb) {
      assertWarning(
        false,
        '`pageContext.httpResponse.pipeToWebWritable(res)` is outdated, use `pageContext.httpResponse.pipe(res)` instead. See ' +
          streamDocs,
        { onlyOnce: true },
      )
      const success = pipeToStreamWritableWeb(htmlRender, writable)
      assertUsage(success, errMsg('pipeToWebWritable()'))
    },
    pipeToNodeWritable(writable: StreamWritableNode) {
      assertWarning(
        false,
        '`pageContext.httpResponse.pipeToNodeWritable(res)` is outdated, use `pageContext.httpResponse.pipe(res)` instead. See ' +
          streamDocs,
        { onlyOnce: true },
      )
      const success = pipeToStreamWritableNode(htmlRender, writable)
      assertUsage(success, errMsg('pipeToNodeWritable()'))
    },
    pipe(writable: StreamWritableNode | StreamWritableWeb) {
      if (isStreamWritableWeb(writable)) {
        const success = pipeToStreamWritableWeb(htmlRender, writable)
        assertUsage(success, errMsg('pipe()'))
        return
      }
      if (isStreamWritableNode(writable)) {
        const success = pipeToStreamWritableNode(htmlRender, writable)
        assertUsage(success, errMsg('pipe()'))
        return
      }
      assertUsage(
        false,
        `The argument \`writable\` passed to \`pageContext.httpResponse.pipe(writable)\` doesn't seem to be ${getStreamName(
          'writable',
          'web',
        )} nor ${getStreamName('writable', 'node')}.`,
      )
    },
  }

  function errMsg(method: string, fixMsg?: string) {
    let htmlRenderName: string
    if (typeof htmlRender === 'string') {
      htmlRenderName = 'an HTML string'
    } else if (isStream(htmlRender)) {
      htmlRenderName = inferStreamName(htmlRender)
    } else {
      assert(false)
    }
    assert(['a ', 'an ', 'the '].some((s) => htmlRenderName.startsWith(s)))
    return [
      `\`pageContext.httpResponse.${method}\` can't be used because your \`render()\` hook (${renderFilePath}) provides ${htmlRenderName}`,
      fixMsg,
      `See ${streamDocs}`,
    ]
      .filter(Boolean)
      .join('. ')
  }
  function fixMsg(type: 'pipe' | 'readable', standard: 'web' | 'node') {
    const streamName = getStreamName(type, standard)
    assert(['a ', 'an ', 'the '].some((s) => streamName.startsWith(s)))
    return `Make sure your \`render()\` hook provides ${streamName} instead`
  }
}

async function prerenderPage(
  pageContext: {
    url: string
    routeParams: Record<string, string>
    _isPreRendering: true
    _pageId: string
    _usesClientRouter: boolean
    _pageContextAlreadyProvidedByPrerenderHook?: true
  } & PageFiles &
    GlobalRenderingContext,
) {
  assert(pageContext._isPreRendering === true)

  objectAssign(pageContext, {
    _isPageContextRequest: false,
    _urlProcessor: null,
  })

  addComputedUrlProps(pageContext)

  await executeOnBeforeRenderHooks(pageContext)

  const renderHookResult = await executeRenderHook(pageContext)
  assertUsage(
    renderHookResult.htmlRender !== null,
    `Cannot pre-render \`${pageContext.url}\` because the \`render()\` hook exported by ${renderHookResult.renderFilePath} didn't return an HTML string.`,
  )
  assert(pageContext._isPageContextRequest === false)
  const documentHtml = await getHtmlString(renderHookResult.htmlRender)
  assert(typeof documentHtml === 'string')
  if (!pageContext._usesClientRouter) {
    return { documentHtml, pageContextSerialized: null, pageContext }
  } else {
    const pageContextSerialized = serializePageContextClientSide(pageContext)
    return { documentHtml, pageContextSerialized, pageContext }
  }
}

async function renderStatic404Page(globalContext: GlobalRenderingContext & { _isPreRendering: true }) {
  const errorPageId = getErrorPageId(globalContext._allPageIds)
  if (!errorPageId) {
    return null
  }

  const pageContext = {
    ...globalContext,
    _pageId: errorPageId,
    is404: true,
    routeParams: {},
    url: '/fake-404-url', // A `url` is needed for `applyViteHtmlTransform`
    // `renderStatic404Page()` is about generating `dist/client/404.html` for static hosts; there is no Client Routing.
    _usesClientRouter: false,
  }

  const pageFiles = await loadPageFilesServer(pageContext)
  objectAssign(pageContext, pageFiles)

  return prerenderPage(pageContext)
}

type PageContextPublic = {
  url: string
  urlPathname: string
  urlParsed: PageContextUrls['urlParsed']
  routeParams: Record<string, string>
  Page: unknown
  pageExports: Record<string, unknown>
  exports: Record<string, unknown>
  exportsAll: ExportsAll
  _pageId: string
  is404?: boolean
  pageProps?: Record<string, unknown>
}
function preparePageContextForRelease<T extends PageContextPublic>(pageContext: T) {
  assert(typeof pageContext.url === 'string')
  assert(typeof pageContext.urlPathname === 'string')
  assert(isPlainObject(pageContext.urlParsed))
  assert(isPlainObject(pageContext.routeParams))
  assert('Page' in pageContext)
  assert(isObject(pageContext.pageExports))
  assert(isObject(pageContext.exports))
  assert(isObject(pageContext.exportsAll))

  sortPageContext(pageContext)

  if (isErrorPage(pageContext._pageId)) {
    assert(hasProp(pageContext, 'is404', 'boolean'))
    addIs404ToPageProps(pageContext)
  }
}

async function loadPageFilesServer(pageContext: {
  url: string
  _pageId: string
  _baseUrl: string
  _baseAssets: string | null
  _pageFilesAll: PageFile[]
  _isPreRendering: boolean
  _isProduction: boolean
  _viteDevServer: null | ViteDevServer
  _manifestClient: null | ViteManifest
}) {
  const [{ exports, exportsAll, pageExports, pageFilesLoaded }] = await Promise.all([
    loadPageFilesServerSide(pageContext._pageFilesAll, pageContext._pageId),
    analyzePageClientSideInit(pageContext._pageFilesAll, pageContext._pageId, { sharedPageFilesAlreadyLoaded: true }),
  ])
  const { isHtmlOnly, isClientRouting, clientEntries, clientDependencies, pageFilesClientSide, pageFilesServerSide } =
    analyzePageClientSide(pageContext._pageFilesAll, pageContext._pageId)
  const pageContextAddendum = {}
  objectAssign(pageContextAddendum, {
    exports,
    exportsAll,
    pageExports,
    Page: exports.Page,
    _isHtmlOnly: isHtmlOnly,
    _passToClient: getExportUnion(exportsAll, 'passToClient'),
    _pageFilePathsLoaded: pageFilesLoaded.map((p) => p.filePath),
  })

  objectAssign(pageContextAddendum, {
    _getPageAssets: async () => {
      if ('_pageAssets' in pageContext) {
        return (pageContext as any as { _pageAssets: PageAsset[] })._pageAssets
      } else {
        const isPreRendering = pageContext._isPreRendering
        assert([true, false].includes(isPreRendering))
        const pageAssets = await getPageAssets(pageContext, clientDependencies, clientEntries, isPreRendering)
        objectAssign(pageContext, { _pageAssets: pageAssets })
        return pageContext._pageAssets
      }
    },
  })

  {
    const pageFilesAll = pageContext._pageFilesAll
    const pageId = pageContext._pageId
    debugPageFiles({
      url: pageContext.url,
      pageId,
      isHtmlOnly,
      isClientRouting,
      pageFilesAll,
      pageFilesLoaded,
      pageFilesClientSide,
      pageFilesServerSide,
      clientEntries,
      clientDependencies,
    })
  }

  return pageContextAddendum
}

function debugPageFiles({
  url,
  pageId,
  isHtmlOnly,
  isClientRouting,
  pageFilesAll,
  pageFilesLoaded,
  pageFilesServerSide,
  pageFilesClientSide,
  clientEntries,
  clientDependencies,
}: {
  url: string
  pageId: string
  isHtmlOnly: boolean
  isClientRouting: boolean
  pageFilesAll: PageFile[]
  pageFilesLoaded: PageFile[]
  pageFilesClientSide: PageFile[]
  pageFilesServerSide: PageFile[]
  clientEntries: string[]
  clientDependencies: ClientDependency[]
}) {
  const debug = createDebugger('vps:pageFiles')
  const padding = '   - '

  debug('All page files:', printPageFiles(pageFilesAll, true))
  debug(`URL:`, url)
  debug(`pageId:`, pageId)
  debug('Page type:', isHtmlOnly ? 'HTML-only' : 'SSR/SPA')
  debug(`Routing type:`, !isHtmlOnly && isClientRouting ? 'Client Routing' : 'Server Routing')
  debug('Server-side page files:', printPageFiles(pageFilesLoaded))
  assert(samePageFiles(pageFilesLoaded, pageFilesServerSide))
  debug('Client-side page files:', printPageFiles(pageFilesClientSide))
  debug(
    'Client-side entries:',
    printEntries(clientEntries, (entry) => entry),
  )
  debug(
    'Client-side dependencies:',
    printEntries(clientDependencies, (entry) => JSON.stringify(entry)),
  )

  return

  function printPageFiles(pageFiles: PageFile[], genericPageFilesLast = false) {
    if (pageFiles.length === 0) {
      return 'None'
    }
    return (
      '\n' +
      pageFiles
        .sort((p1, p2) => p1.filePath.localeCompare(p2.filePath))
        .sort(makeFirst((p) => (p.isRendererPageFile ? !genericPageFilesLast : null)))
        .sort(makeFirst((p) => (p.isDefaultPageFile ? !genericPageFilesLast : null)))
        .map((p) => p.filePath)
        .map((s) => s.split('_default.page.').join(`${pc.blue('_default')}.page.`))
        .map((s) => s.split('/renderer/').join(`/${pc.red('renderer')}/`))
        .map((s) => padding + s)
        .join('\n')
    )
  }

  function printEntries<T>(list: T[], str: (entry: T) => string) {
    if (list.length === 0) {
      return 'None'
    }
    return '\n' + list.map((entry) => padding + str(entry)).join('\n')
  }
}

function samePageFiles(pageFiles1: PageFile[], pageFiles2: PageFile[]) {
  return (
    pageFiles1.every((p1) => pageFiles2.some((p2) => p2.filePath === p1.filePath)) &&
    pageFiles2.every((p2) => pageFiles1.some((p1) => p1.filePath === p2.filePath))
  )
}

async function executeOnBeforeRenderHooks(
  pageContext: {
    _pageId: string
    _pageContextAlreadyProvidedByPrerenderHook?: true
  } & PageContextExports &
    PageContextPublic,
): Promise<void> {
  if (pageContext._pageContextAlreadyProvidedByPrerenderHook) {
    return
  }
  const hook = getHook(pageContext, 'onBeforeRender')
  if (!hook) {
    return
  }
  const onBeforeRender = hook.hook
  preparePageContextForRelease(pageContext)
  const hookResult = await onBeforeRender(pageContext)

  assertHookResult(hookResult, 'onBeforeRender', ['pageContext'], hook.filePath)
  const pageContextFromHook = hookResult?.pageContext
  Object.assign(pageContext, pageContextFromHook)
}

async function executeRenderHook(
  pageContext: PageContextPublic & {
    _pageId: string
    _isPreRendering: boolean
    _getPageAssets: () => Promise<PageAsset[]>
    _passToClient: string[]
    _pageFilesAll: PageFile[]
    _isHtmlOnly: boolean
    _isProduction: boolean
    _viteDevServer: ViteDevServer | null
    _baseUrl: string
    _pageFilePathsLoaded: string[]
  },
): Promise<{
  renderFilePath: string
  htmlRender: null | HtmlRender
}> {
  const hook = getHook(pageContext, 'render')
  assertUsage(
    hook,
    `No \`render()\` hook found. See https://vite-plugin-ssr.com/render for more information. Loaded pages (none of them \`export { render }\`):\n${pageContext._pageFilePathsLoaded
      .map((f) => `  ${f}`)
      .join('\n')}`,
  )
  const render = hook.hook
  const renderFilePath = hook.filePath

  preparePageContextForRelease(pageContext)
  const result = await render(pageContext)
  if (isObject(result) && !isDocumentHtml(result)) {
    assertHookResult(result, 'render', ['documentHtml', 'pageContext'] as const, renderFilePath)
  }
  objectAssign(pageContext, { _renderHook: { hookFilePath: renderFilePath, hookName: 'render' as const } })

  let pageContextPromise: Promise<unknown> | null = null
  if (hasProp(result, 'pageContext')) {
    const pageContextProvidedByRenderHook = result.pageContext
    if (isPromise(pageContextProvidedByRenderHook)) {
      pageContextPromise = pageContextProvidedByRenderHook
    } else {
      assertPageContextProvidedByUser(pageContextProvidedByRenderHook, { hook: pageContext._renderHook })
      Object.assign(pageContext, pageContextProvidedByRenderHook)
    }
  }
  objectAssign(pageContext, { _pageContextPromise: pageContextPromise })

  const errPrefix = 'The `render()` hook exported by ' + renderFilePath
  const errSuffix = [
    'a string generated with the `escapeInject` template tag or a string returned by `dangerouslySkipEscape()`,',
    'see https://vite-plugin-ssr.com/escapeInject',
  ].join(' ')

  let documentHtml: unknown
  if (!isObject(result) || isDocumentHtml(result)) {
    assertUsage(
      typeof result !== 'string',
      [
        errPrefix,
        'returned a plain JavaScript string which is forbidden;',
        'instead, it should return',
        errSuffix,
      ].join(' '),
    )
    assertUsage(
      result === null || isDocumentHtml(result),
      [
        errPrefix,
        'should return `null`, a string `documentHtml`, or an object `{ documentHtml, pageContext }`',
        'where `pageContext` is `undefined` or an object holding additional `pageContext` values',
        'and `documentHtml` is',
        errSuffix,
      ].join(' '),
    )
    documentHtml = result
  } else {
    assertObjectKeys(result, ['documentHtml', 'pageContext'] as const, errPrefix)
    if ('documentHtml' in result) {
      documentHtml = result.documentHtml
      assertUsage(
        typeof documentHtml !== 'string',
        [
          errPrefix,
          'returned `{ documentHtml }`, but `documentHtml` is a plain JavaScript string which is forbidden;',
          '`documentHtml` should be',
          errSuffix,
        ].join(' '),
      )
      assertUsage(
        documentHtml === undefined || documentHtml === null || isDocumentHtml(documentHtml),
        [errPrefix, 'returned `{ documentHtml }`, but `documentHtml` should be', errSuffix].join(' '),
      )
    }
  }

  assert(documentHtml === undefined || documentHtml === null || isDocumentHtml(documentHtml))

  if (documentHtml === null || documentHtml === undefined) {
    return { htmlRender: null, renderFilePath }
  }

  const onErrorWhileStreaming = (err: unknown) => {
    assertError(err)
    logError(err)
    objectAssign(pageContext, {
      errorWhileRendering: err,
      _serverSideErrorWhileStreaming: true,
    })
  }
  const htmlRender = await renderHtml(documentHtml, pageContext, renderFilePath, onErrorWhileStreaming)
  assert(typeof htmlRender === 'string' || isStream(htmlRender))
  return { htmlRender, renderFilePath }
}

function assertArguments(...args: unknown[]) {
  const pageContext = args[0]
  assertUsage(pageContext, '`renderPage(pageContext)`: argument `pageContext` is missing.')
  assertUsage(
    isPlainObject(pageContext),
    `\`renderPage(pageContext)\`: argument \`pageContext\` should be a plain JavaScript object, but you passed a \`pageContext\` with \`pageContext.constructor === ${
      (pageContext as any).constructor
    }\`.`,
  )
  assertUsage(
    hasProp(pageContext, 'url'),
    '`renderPage(pageContext)`: The `pageContext` you passed is missing the property `pageContext.url`.',
  )
  assertUsage(
    typeof pageContext.url === 'string',
    '`renderPage(pageContext)`: `pageContext.url` should be a string but `typeof pageContext.url === "' +
      typeof pageContext.url +
      '"`.',
  )
  assertUsage(
    pageContext.url.startsWith('/') || pageContext.url.startsWith('http'),
    '`renderPage(pageContext)`: `pageContext.url` should start with `/` (e.g. `/product/42`) or `http` (e.g. `http://example.org/product/42`) but `pageContext.url === "' +
      pageContext.url +
      '"`.',
  )
  try {
    const { url } = pageContext
    const urlWithOrigin = url.startsWith('http') ? url : 'http://fake-origin.example.org' + url
    // `new URL()` conveniently throws if URL is not an URL
    new URL(urlWithOrigin)
  } catch (err) {
    assertUsage(
      false,
      '`renderPage(pageContext)`: `pageContext.url` should be a URL but `pageContext.url==="' + pageContext.url + '"`.',
    )
  }
  const len = args.length
  assertUsage(
    len === 1,
    `\`renderPage(pageContext)\`: You passed ${len} arguments but \`renderPage()\` accepts only one argument.'`,
  )
}

function warnMissingErrorPage(pageContext: { _isProduction: boolean }) {
  if (!pageContext._isProduction) {
    assertWarning(
      false,
      'No `_error.page.js` found. We recommend creating a `_error.page.js` file. (This warning is not shown in production.)',
      { onlyOnce: true },
    )
  }
}

function logError(err: unknown) {
  assertError(err)

  if (viteAlreadyLoggedError(err)) {
    return
  }

  if (!isObject(err)) {
    console.warn('[vite-plugin-ssr] The thrown value is:')
    console.warn(err)
    assertWarning(
      false,
      "Your source code threw a value that is not an object. Make sure to wrap the value with `new Error()`. For example, if your code throws `throw 'some-string'` then do `throw new Error('some-string')` instead. The thrown value is printed above. Feel free to contact vite-plugin-ssr maintainers to get help.",
      { onlyOnce: false },
    )
  }

  // Avoid logging error twice (not sure if this actually ever happens?)
  if (hasAlreadyLogged(err)) {
    return
  }

  viteErrorCleanup(err)

  // We ensure we print a string; Cloudflare Workers doesn't seem to properly stringify `Error` objects.
  const errStr = (hasProp(err, 'stack') && String(err.stack)) || String(err)
  console.error(errStr)
  setAlreadyLogged(err)
}

function hasAlreadyLogged(err: unknown) {
  assert(isObject(err))
  const key = '_wasAlreadyConsoleLogged'
  return err[key] === true
}
function setAlreadyLogged(err: unknown) {
  assert(isObject(err))
  const key = '_wasAlreadyConsoleLogged'
  err[key] = true
}
