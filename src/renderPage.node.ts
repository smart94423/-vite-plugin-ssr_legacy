import devalue from 'devalue'
import {
  getErrorPageId,
  getPageIds,
  route,
  isErrorPage,
  loadPageRoutes,
  getFilesystemRoute
} from './route.shared'
import { renderHtmlTemplate, isHtmlTemplate } from './html.node'
import { getViteManifest, ViteManifest } from './getViteManifest.node'
import { getUserFile, getUserFiles } from './user-files/getUserFiles.shared'
import { getSsrEnv } from './ssrEnv.node'
import { getPreloadTags, prependBaseUrl } from './getPreloadTags.node'
import { relative as pathRelative } from 'path'
import { stringify } from '@brillout/json-s'
import {
  assert,
  assertUsage,
  lowerFirst,
  isCallable,
  slice,
  cast,
  assertWarning,
  hasProp,
  isPromise,
  isPagePropsUrl,
  retrieveOriginalUrl,
  parseUrl
} from './utils'

export { renderPage }
export { getPageFunctions }
export { prerenderPage }

async function renderPage({
  url,
  contextProps = {}
}: {
  url: string
  contextProps: Record<string, unknown>
}): Promise<
  | { nothingRendered: true; renderResult: undefined; statusCode: undefined }
  | {
      nothingRendered: false
      renderResult: string | unknown
      statusCode: 200 | 404 | 500
    }
> {
  assertArguments(...arguments)

  if (url === '/favicon.ico') {
    return {
      nothingRendered: true,
      renderResult: undefined,
      statusCode: undefined
    }
  }

  const isPagePropsRequest = isPagePropsUrl(url)
  if (isPagePropsRequest) {
    url = retrieveOriginalUrl(url)
  }

  Object.assign(contextProps, { url })

  const allPageIds = await getPageIds()

  // *** Route ***
  // We use a try-catch because `route()` executes `.page.route.js` source code which is
  // written by the user and may contain errors.
  let routeResult
  try {
    routeResult = await route(url, allPageIds, contextProps)
  } catch (err) {
    if (isPagePropsRequest) {
      return renderPagePropsError(err)
    } else {
      return await render500Page(err, allPageIds, contextProps, url)
    }
  }

  // *** Handle 404 ***
  let statusCode: 200 | 404
  if (!routeResult) {
    await warn404(url, allPageIds)
    if (isPagePropsRequest) {
      return renderPagePropsError()
    }
    const errorPageId = getErrorPageId(allPageIds)
    if (!errorPageId) {
      warnMissingErrorPage()
      return {
        nothingRendered: true,
        renderResult: undefined,
        statusCode: undefined
      }
    }
    statusCode = 404
    routeResult = { pageId: errorPageId, contextPropsAddendum: { is404: true } }
  } else {
    statusCode = 200
  }

  const { pageId, contextPropsAddendum } = routeResult
  Object.assign(contextProps, contextPropsAddendum)

  // *** Render ***
  // We use a try-catch because `renderPageId()` execute a `*.page.*` file which is
  // written by the user and may contain an error.
  let renderResult
  try {
    renderResult = await renderPageId(
      pageId,
      contextProps,
      url,
      false,
      isPagePropsRequest
    )
  } catch (err) {
    if (isPagePropsRequest) {
      return renderPagePropsError(err)
    } else {
      return await render500Page(err, allPageIds, contextProps, url)
    }
  }

  return { nothingRendered: false, renderResult, statusCode }
}

async function renderPageId(
  pageId: string,
  contextProps: Record<string, unknown>,
  url: string,
  contextPropsAlreadyFetched: boolean = false,
  isPagePropsRequest: boolean = false
) {
  const renderData = await getRenderData(
    pageId,
    contextProps,
    url,
    contextPropsAlreadyFetched,
    false
  )

  if (isPagePropsRequest) {
    const renderResult = renderPageProps(renderData)
    return renderResult
  } else {
    const renderResult = await renderHtmlDocument(renderData)
    return renderResult
  }
}

async function prerenderPage(
  pageId: string,
  contextProps: Record<string, unknown>,
  url: string,
  contextPropsAlreadyFetched: boolean,
  serializePageProps: boolean
) {
  const renderData = await getRenderData(
    pageId,
    contextProps,
    url,
    contextPropsAlreadyFetched,
    true
  )
  const htmlDocument = await renderHtmlDocument(renderData)
  assertUsage(
    typeof htmlDocument === 'string',
    "Pre-rendering requires your `html()` hook to return a string. Open a GitHub issue if that's a problem for you."
  )
  if (!serializePageProps) {
    return { htmlDocument, pagePropsSerialized: null }
  }
  const pagePropsSerialized = renderPageProps(renderData)
  return { htmlDocument, pagePropsSerialized }
}

async function getRenderData(
  pageId: string,
  contextProps: Record<string, unknown>,
  url: string,
  contextPropsAlreadyFetched: boolean,
  isPreRendering: boolean
) {
  const { Page, pageFilePath } = await getPage(pageId)

  const pageFunctions = await getPageFunctions(pageId)
  const { addContextPropsFunction, setPagePropsFunction } = pageFunctions

  if (!contextPropsAlreadyFetched && addContextPropsFunction) {
    const contextPropsAddendum = await addContextPropsFunction.addContextProps({
      Page,
      contextProps
    })
    assertUsage(
      typeof contextPropsAddendum === 'object' &&
        contextPropsAddendum !== null &&
        contextPropsAddendum.constructor === Object,
      `The \`addContextProps()\` hook exported by ${addContextPropsFunction.filePath} should return a plain JavaScript object.`
    )
    Object.assign(contextProps, contextPropsAddendum)
  }

  const pageProps: Record<string, unknown> = {}
  if (setPagePropsFunction) {
    const pagePropsAddendum = setPagePropsFunction.setPageProps({
      contextProps
    })
    assertUsage(
      typeof pagePropsAddendum === 'object' &&
        pagePropsAddendum !== null &&
        pagePropsAddendum.constructor === Object,
      `The \`setPageProps()\` hook exported by ${setPagePropsFunction.filePath} should return a plain JavaScript object.`
    )
    assertUsage(
      !isPromise(pagePropsAddendum),
      `The \`setPageProps()\` hook exported by ${setPagePropsFunction.filePath} returns a promise which is not allowed: \`setPageProps()\` hooks should be synchronous. Use the \`addContextProps()\` hook to asynchronously fetch data instead.`
    )
    Object.assign(pageProps, pagePropsAddendum)
  } else if (isErrorPage(pageId)) {
    assert(
      hasProp(contextProps, 'is404') && typeof contextProps.is404 === 'boolean'
    )
    Object.assign(pageProps, { is404: contextProps.is404 })
  }

  return {
    Page,
    pageId,
    pageFilePath,
    pageFunctions,
    contextProps,
    pageProps,
    url,
    isPreRendering
  }
}

type RenderData = {
  Page: unknown
  contextProps: Record<string, unknown>
  pageProps: Record<string, unknown>
  url: string
  pageId: string
  pageFilePath: string
  pageFunctions: PageFunctions
  isPreRendering: boolean
}

function renderPageProps({ pageProps }: RenderData) {
  const pagePropsSerialized = stringify({
    pageProps
  })
  return pagePropsSerialized
}
async function renderHtmlDocument({
  Page,
  contextProps,
  pageProps,
  url,
  pageId,
  pageFilePath,
  pageFunctions,
  isPreRendering
}: RenderData) {
  const {
    renderFunction,
    addContextPropsFunction,
    setPagePropsFunction
  } = pageFunctions

  const { isProduction = false } = getSsrEnv()
  let clientManifest: null | ViteManifest = null
  let serverManifest: null | ViteManifest = null
  if (isPreRendering || isProduction) {
    const manifests = retrieveViteManifest(isPreRendering)
    clientManifest = manifests.clientManifest
    serverManifest = manifests.serverManifest
  }

  const renderResult: unknown = await renderFunction.render({
    Page,
    contextProps,
    pageProps
  })

  if (!isHtmlTemplate(renderResult)) {
    // Allow user to return whatever he wants in their `render` hook, such as `{redirectTo: '/some/path'}`.
    if (typeof renderResult !== 'string') {
      return renderResult
    }
    assertUsage(
      typeof renderResult !== 'string',
      `The \`render()\` hook exported by ${renderFunction.filePath} returned a string that is an unsafe. Make sure to return a sanitized string by using the \`html\` tag (\`import { html } from 'vite-plugin-ssr'\`).`
    )
  }
  let htmlDocument: string = renderHtmlTemplate(
    renderResult,
    renderFunction.filePath
  )

  // Inject Vite transformations
  htmlDocument = await applyViteHtmlTransform(htmlDocument, url)

  // Inject pageProps
  htmlDocument = injectPageInfo(htmlDocument, pageProps, pageId)

  // Inject script
  const browserFilePath = await getBrowserFilePath(pageId)
  const scriptSrc = !isProduction
    ? browserFilePath
    : resolveScriptSrc(browserFilePath, clientManifest!)
  htmlDocument = injectScript(htmlDocument, scriptSrc)

  // Inject preload links
  const dependencies = new Set<string>()
  dependencies.add(pageFilePath)
  dependencies.add(browserFilePath)
  dependencies.add(renderFunction.filePath)
  if (setPagePropsFunction) dependencies.add(setPagePropsFunction.filePath)
  if (addContextPropsFunction)
    dependencies.add(addContextPropsFunction.filePath)
  const preloadTags = await getPreloadTags(
    Array.from(dependencies),
    clientManifest,
    serverManifest
  )
  htmlDocument = injectPreloadTags(htmlDocument, preloadTags)

  return htmlDocument
}

async function getPage(pageId: string) {
  const pageFile = await getUserFile('.page', pageId)
  assert(pageFile)
  const { filePath, loadFile } = pageFile
  const fileExports = await loadFile()
  assertUsage(
    typeof fileExports === 'object' &&
      ('Page' in fileExports || 'default' in fileExports),
    `${filePath} should have a \`export { Page }\` (or a default export).`
  )
  const Page = fileExports.Page || fileExports.default

  return { Page, pageFilePath: filePath }
}

type PageFunctions = {
  renderFunction: {
    filePath: string
    render: (arg1: {
      Page: unknown
      contextProps: Record<string, unknown>
      pageProps: Record<string, unknown>
    }) => unknown
  }
  addContextPropsFunction?: {
    filePath: string
    addContextProps: (arg1: {
      Page: unknown
      contextProps: Record<string, unknown>
    }) => unknown
  }
  setPagePropsFunction?: {
    filePath: string
    setPageProps: (arg1: { contextProps: Record<string, unknown> }) => unknown
  }
  prerenderFunction?: {
    filePath: string
    prerender: () => unknown
  }
}
async function getPageFunctions(pageId: string): Promise<PageFunctions> {
  const serverFiles = await getServerFiles(pageId)

  let renderFunction
  let addContextPropsFunction
  let setPagePropsFunction
  let prerenderFunction

  for (const { filePath, loadFile } of serverFiles) {
    const fileExports = await loadFile()

    const render = fileExports.render || fileExports.default?.render
    assertUsage(
      !render || isCallable(render),
      `The \`render()\` hook defined in ${filePath} should be a function.`
    )
    const addContextProps =
      fileExports.addContextProps || fileExports.default?.addContextProps
    assertUsage(
      !addContextProps || isCallable(addContextProps),
      `The \`addContextProps()\` hook defined in ${filePath} should be a function.`
    )
    const setPageProps =
      fileExports.setPageProps || fileExports.default?.setPageProps
    assertUsage(
      !setPageProps || isCallable(setPageProps),
      `The \`setPageProps()\` hook defined in ${filePath} should be a function.`
    )
    const prerender = fileExports.prerender || fileExports.default?.prerender
    assertUsage(
      !prerender || isCallable(prerender),
      `The \`prerender()\` hook defined in ${filePath} should be a function.`
    )

    if (render) {
      renderFunction = renderFunction || { render, filePath }
    }
    if (addContextProps) {
      addContextPropsFunction = addContextPropsFunction || {
        addContextProps,
        filePath
      }
    }
    if (setPageProps) {
      setPagePropsFunction = setPagePropsFunction || { setPageProps, filePath }
    }
    if (prerender) {
      prerenderFunction = prerenderFunction || { prerender, filePath }
    }
  }

  assertUsage(
    renderFunction,
    'No `render` function found. Make sure to define a `*.page.server.js` file that exports a `render` function. You can export a `render` function in a file `_default.page.server.js` which will apply as default to all your pages.'
  )

  return {
    renderFunction,
    addContextPropsFunction,
    setPagePropsFunction,
    prerenderFunction
  }
}

async function getBrowserFilePath(pageId: string) {
  const browserFiles = await getBrowserFiles(pageId)
  const browserFile = browserFiles[0]
  const browserFilePath = browserFile.filePath
  return browserFilePath
}
async function getBrowserFiles(pageId: string) {
  let browserFiles = await getUserFiles('.page.client')
  assertUsage(
    browserFiles.length > 0,
    'No *.page.client.* file found. Make sure to create one. You can create a `_default.page.client.js` which will apply as default to all your pages.'
  )
  browserFiles = filterAndSort(browserFiles, pageId)
  return browserFiles
}

async function getServerFiles(pageId: string) {
  let serverFiles = await getUserFiles('.page.server')
  assertUsage(
    serverFiles.length > 0,
    'No *.page.server.* file found. Make sure to create one. You can create a `_default.page.server.js` which will apply as default to all your pages.'
  )
  serverFiles = filterAndSort(serverFiles, pageId)
  return serverFiles
}

function filterAndSort<T extends { filePath: string }>(
  userFiles: T[],
  pageId: string
): T[] {
  userFiles = userFiles.filter(({ filePath }) => {
    assert(filePath.startsWith('/'))
    assert(!filePath.includes('\\'))
    return filePath.startsWith(pageId) || filePath.includes('/_default')
  })

  // Sort `_default.page.server.js` files by filesystem proximity to pageId's `*.page.js` file
  userFiles.sort(
    lowerFirst(({ filePath }) => {
      if (filePath.startsWith(pageId)) return -1
      const relativePath = pathRelative(pageId, filePath)
      assert(!relativePath.includes('\\'))
      const changeDirCount = relativePath.split('/').length
      return changeDirCount
    })
  )

  return userFiles
}

async function applyViteHtmlTransform(
  htmlDocument: string,
  url: string
): Promise<string> {
  const ssrEnv = getSsrEnv()
  if (ssrEnv.isProduction) {
    return htmlDocument
  }
  htmlDocument = await ssrEnv.viteDevServer.transformIndexHtml(
    url,
    htmlDocument
  )
  return htmlDocument
}

function resolveScriptSrc(
  filePath: string,
  clientManifest: ViteManifest
): string {
  assert(filePath.startsWith('/'))
  assert(getSsrEnv().isProduction)
  const manifestKey = filePath.slice(1)
  const manifestVal = clientManifest[manifestKey]
  assert(manifestVal)
  assert(manifestVal.isEntry)
  const { file } = manifestVal
  assert(!file.startsWith('/'))
  return '/' + file
}

function injectPageInfo(
  htmlDocument: string,
  pageProps: Record<string, unknown>,
  pageId: string
): string {
  const injection = `<script>window.__vite_plugin_ssr = {pageId: ${devalue(
    pageId
  )}, pageProps: ${devalue(pageProps)}}</script>`
  return injectEnd(htmlDocument, injection)
}

function injectScript(htmlDocument: string, scriptSrc: string): string {
  const injection = `<script type="module" src="${prependBaseUrl(
    scriptSrc
  )}"></script>`
  return injectEnd(htmlDocument, injection)
}

function injectPreloadTags(
  htmlDocument: string,
  preloadTags: string[]
): string {
  const injection = preloadTags.join('')
  return injectBegin(htmlDocument, injection)
}

function injectBegin(htmlDocument: string, injection: string): string {
  const headOpen = /<head[^>]*>/
  if (headOpen.test(htmlDocument)) {
    return injectAtOpeningTag(htmlDocument, headOpen, injection)
  }

  const htmlBegin = /<html[^>]*>/
  if (htmlBegin.test(htmlDocument)) {
    return injectAtOpeningTag(htmlDocument, htmlBegin, injection)
  }

  if (htmlDocument.toLowerCase().startsWith('<!doctype')) {
    const lines = htmlDocument.split('\n')
    return [...slice(lines, 0, 1), injection, ...slice(lines, 1, 0)].join('\n')
  } else {
    return injection + '\n' + htmlDocument
  }
}

function injectEnd(htmlDocument: string, injection: string): string {
  const bodyClose = '</body>'
  if (htmlDocument.includes(bodyClose)) {
    return injectAtClosingTag(htmlDocument, bodyClose, injection)
  }

  const htmlClose = '</html>'
  if (htmlDocument.includes(htmlClose)) {
    return injectAtClosingTag(htmlDocument, htmlClose, injection)
  }

  return htmlDocument + '\n' + injection
}

function injectAtOpeningTag(
  htmlDocument: string,
  openingTag: RegExp,
  injection: string
): string {
  const matches = htmlDocument.match(openingTag)
  assert(matches && matches.length >= 1)
  const tag = matches[0]
  const htmlParts = htmlDocument.split(tag)
  assert(htmlParts.length >= 2)

  // Insert `injection` after first `tag`
  const before = slice(htmlParts, 0, 1)
  const after = slice(htmlParts, 1, 0).join(tag)
  return before + tag + injection + after
}

function injectAtClosingTag(
  htmlDocument: string,
  closingTag: string,
  injection: string
): string {
  assert(closingTag.startsWith('</'))
  assert(closingTag.endsWith('>'))
  assert(!closingTag.includes(' '))

  const htmlParts = htmlDocument.split(closingTag)
  assert(htmlParts.length >= 2)

  // Insert `injection` before last `closingTag`
  const before = slice(htmlParts, 0, -1).join(closingTag)
  const after = slice(htmlParts, -1, 0)
  return before + injection + closingTag + after
}

function assertArguments(...args: unknown[]) {
  const argObject = args[0]
  assertUsage(
    hasProp(argObject, 'url'),
    '`render({url, contextProps})`: argument `url` is missing.'
  )
  assertUsage(
    typeof argObject.url === 'string' && argObject.url.startsWith('/'),
    '`render({url, contextProps})`: argument `url` should start with a `/`.'
  )
  assertUsage(
    !hasProp(argObject, 'contextProps') ||
      typeof argObject.contextProps === 'object',
    '`render({url, contextProps})`: argument `contextProps` should be a `typeof contextProps === "object"`.'
  )
  assertUsage(
    args.length === 1,
    '`render({url, contextProps})`: all arguments should be passed as a single argument object.'
  )
  const unknownArgs = Object.keys(argObject).filter(
    (key) => !['url', 'contextProps'].includes(key)
  )
  assertUsage(
    unknownArgs.length === 0,
    '`render({url, contextProps})`: unknown arguments [' +
      unknownArgs.map((s) => `'${s}'`).join(', ') +
      '].'
  )
}

function warnMissingErrorPage() {
  const { isProduction } = getSsrEnv()
  if (!isProduction) {
    assertWarning(
      false,
      'No `_error.page.js` found. We recommend creating a `_error.page.js` file. (This warning is not shown in production.)'
    )
  }
}
async function warn404(url: string, allPageIds: string[]) {
  const { isProduction } = getSsrEnv()
  const relevantPageIds = allPageIds.filter((pageId) => !isErrorPage(pageId))
  assertUsage(
    relevantPageIds.length > 0,
    'No page found. Create a file that ends with the suffix `.page.js` (or `.page.vue`, `.page.jsx`, ...).'
  )
  if (!isProduction && !isFileRequest(url)) {
    assertWarning(
      false,
      `No page is matching the URL \`${
        parseUrl(url).pathname
      }\`. ${await getPagesAndRoutesInfo()}. (This warning is not shown in production.)`
    )
  }
}
async function getPagesAndRoutesInfo(): Promise<string> {
  const allPageIds = await getPageIds()
  const pageRoutes = await loadPageRoutes()
  const relevantPageIds = allPageIds.filter((pageId) => !isErrorPage(pageId))
  return [
    'Defined pages:',
    relevantPageIds
      .map((pageId) => {
        let routeInfo
        let routeSrc
        if (!(pageId in pageRoutes)) {
          routeInfo = `\`${getFilesystemRoute(pageId, allPageIds)}\``
          routeSrc = 'Filesystem Routing'
        } else {
          const { pageRoute, pageRouteFile } = pageRoutes[pageId]
          const pageRouteStringified = truncateString(
            String(pageRoute).split(/\s/).filter(Boolean).join(' '),
            64
          )
          routeInfo = `\`${pageRouteStringified}\``
          const routeType =
            typeof pageRoute === 'string' ? 'Route String' : 'Route Function'
          const routeFile = pageRouteFile
          routeSrc = `${routeType} defined in \`${routeFile}\``
        }
        return `\`${pageId}.page.*\` with route ${routeInfo} (${routeSrc})`
      })
      .join(', ')
  ].join(' ')
}

function truncateString(str: string, len: number) {
  if (len > str.length) {
    return str
  } else {
    str = str.substring(0, len)
    return str + '...'
  }
}

function isFileRequest(url: string) {
  const { pathname } = parseUrl(url)
  assert(pathname.startsWith('/'))
  const paths = pathname.split('/')
  const lastPath = paths[paths.length - 1]
  const parts = lastPath.split('.')
  if (parts.length < 2) {
    return false
  }
  const fileExtension = parts[parts.length - 1]
  return /^[a-z0-9]+$/.test(fileExtension)
}

async function render500Page(
  err: unknown,
  allPageIds: string[],
  contextProps: Record<string, unknown>,
  url: string
): Promise<
  | { nothingRendered: true; renderResult: undefined; statusCode: undefined }
  | { nothingRendered: false; renderResult: string | unknown; statusCode: 500 }
> {
  handleErr(err)

  const errorPageId = getErrorPageId(allPageIds)
  if (errorPageId === null) {
    warnMissingErrorPage()
    return {
      nothingRendered: true,
      renderResult: undefined,
      statusCode: undefined
    }
  }

  Object.assign(contextProps, { is404: false })
  let renderResult
  try {
    renderResult = await renderPageId(errorPageId, contextProps, url)
  } catch (err) {
    // We purposely swallow the error, because another error was already shown to the user in `handleErr()`.
    // (And chances are high that this is the same error.)
    return {
      nothingRendered: true,
      renderResult: undefined,
      statusCode: undefined
    }
  }
  return { nothingRendered: false, renderResult, statusCode: 500 }
}

function renderPagePropsError(
  err?: unknown
): { nothingRendered: false; renderResult: string; statusCode: 500 } {
  if (err) {
    handleErr(err)
  }
  const renderResult = stringify({
    userError: true
  })
  return { nothingRendered: false, renderResult, statusCode: 500 }
}

function handleErr(err: unknown) {
  const { viteDevServer } = getSsrEnv()
  if (viteDevServer) {
    cast<Error>(err)
    if (err?.stack) {
      viteDevServer.ssrFixStacktrace(err)
    }
  }
  console.error(err)
}

function retrieveViteManifest(
  isPreRendering: boolean
): { clientManifest: ViteManifest; serverManifest: ViteManifest } {
  // Get Vite manifest
  const {
    clientManifest,
    serverManifest,
    clientManifestPath,
    serverManifestPath
  } = getViteManifest()
  const userOperation = isPreRendering
    ? 'running `$ vite-plugin-ssr prerender`'
    : 'running the server with `isProduction: true`'
  assertUsage(
    clientManifest && serverManifest,
    'You are ' +
      userOperation +
      " but you didn't build your app yet: make sure to run `$ vite build && vite build --ssr` before. (Following build manifest is missing: `" +
      clientManifestPath +
      '` and/or `' +
      serverManifestPath +
      '`.)'
  )
  return { clientManifest, serverManifest }
}
