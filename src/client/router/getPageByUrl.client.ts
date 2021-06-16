import { assert, hasProp, isPlainObject } from '../../utils'
import { getPageContext } from './getPageContext.client'
import { getPageById } from '../getPage.client'

export { getPageByUrl }

async function getPageByUrl(
  url: string,
  useOriginalDataWhenPossible: boolean = true
): Promise<{ Page: unknown; pageExports: Record<string, unknown> }> {
  const pageContext = await getPageContext(url, useOriginalDataWhenPossible)
  assert(isPlainObject(pageContext))
  assert(typeof pageContext._pageId === 'string')
  const { Page, pageExports } = await getPageById(pageContext._pageId)
  pageContext.Page = Page
  assert(hasProp(pageContext, 'Page'))
  pageContext.pageExports = pageExports
  assert(hasProp(pageContext, 'pageExports', 'object'))
  return pageContext
}
