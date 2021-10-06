import { hasProp, objectAssign } from '../shared/utils'
import { assert, assertUsage, throwError } from '../shared/utils/assert'

export { getPageContextSerializedInHtml }

function getPageContextSerializedInHtml(): {
  _pageId: string
  _pageContextRetrievedFromServer: Record<string, unknown>
} & Record<string, unknown> {
  assertUsage(
    '__vite_plugin_ssr__pageContext' in window,
    'Client-side `pageContext` missing. Make sure to apply `injectAssets()` to the HTML strings you generate, see https://vite-plugin-ssr.com/injectAssets'
  )

  const pageContext: Record<string, unknown> = {}
  Object.assign(pageContext, window.__vite_plugin_ssr__pageContext)
  assert(hasProp(pageContext, '_pageId', 'string'))
  if ('_serverSideErrorWhileStreaming' in pageContext) {
    throwError(`An error occurred on the server while rendering/streaming to HTML. Check your server logs.`)
  }

  objectAssign(pageContext, {
    _pageContextRetrievedFromServer: { ...pageContext }
  })

  return pageContext
}
declare global {
  interface Window {
    __vite_plugin_ssr__pageContext: Record<string, unknown>
  }
}
