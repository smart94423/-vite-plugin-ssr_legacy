import { getPageFilesAllClientSide } from '../../shared/getPageFiles'
import { assertBaseUrl, PromiseType, getBaseUrl, objectAssign } from './utils'

export { getGlobalContext }

let globalContext: PromiseType<ReturnType<typeof retrieveGlobalContext>>

async function getGlobalContext() {
  if (!globalContext) {
    globalContext = await retrieveGlobalContext()
  }
  return globalContext
}

async function retrieveGlobalContext() {
  const baseUrl = getBaseUrl()
  assertBaseUrl(baseUrl)
  const globalContext = {
    _parseUrl: null,
    _baseUrl: baseUrl,
    _objectCreatedByVitePluginSsr: true,
    // @ts-ignore
    _isProduction: import.meta.env.PROD,
  }
  const { pageFilesAll, allPageIds } = getPageFilesAllClientSide()
  objectAssign(globalContext, {
    _pageFilesAll: pageFilesAll,
    _allPageIds: allPageIds,
  })
  return globalContext
}
