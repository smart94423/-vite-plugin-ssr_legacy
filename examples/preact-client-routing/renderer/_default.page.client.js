import { hydrate, render } from 'preact'
import { useClientRouter } from 'vite-plugin-ssr/client/router'
import { PageShell } from './PageShell'

const { hydrationPromise } = useClientRouter({
  render(pageContext) {
    const { Page, pageProps } = pageContext
    const page = (
      <PageShell pageContext={pageContext}>
        <Page {...pageProps} />
      </PageShell>
    )
    const container = document.querySelector('body')
    console.log({ container, Page, pageProps })
    if (pageContext.isHydration && container) {
      hydrate(page, container)
    } else if (container) {
      render(page, container)
    }
    document.title = getPageTitle(pageContext)
  },
  onTransitionStart,
  onTransitionEnd,
})

hydrationPromise.then(() => {
  console.log('Hydration finished; page is now interactive.')
})

function onTransitionStart() {
  console.log('Page transition start')
  document.querySelector('#page-content').classList.add('page-transition')
}
function onTransitionEnd() {
  console.log('Page transition end')
  document.querySelector('#page-content').classList.remove('page-transition')
}

function getPageTitle(pageContext) {
  const title =
    // For static titles (defined in the `export { documentProps }` of the page's `.page.js`)
    (pageContext.pageExports.documentProps || {}).title ||
    // For dynamic tiles (defined in the `export addContextProps()` of the page's `.page.server.js`)
    (pageContext.documentProps || {}).title ||
    'Demo'
  return title
}
