import type { PageContextBuiltInServer } from 'vite-plugin-ssr/types'
import { RenderErrorPage } from 'vite-plugin-ssr/RenderErrorPage'

export { onBeforeRender }
export { prerender }

const names = ['evan', 'rom', 'alice', 'jon', 'eli']

async function onBeforeRender(pageContext: PageContextBuiltInServer) {
  const { name } = pageContext.routeParams
  if (name !== 'anonymous' && !names.includes(name)) {
    const errorDescription = `Unknown name: ${name}.`
    throw RenderErrorPage({ pageContext: { pageProps: { errorDescription } } })
  }
  const pageProps = { name }
  return {
    pageContext: {
      pageProps
    }
  }
}

function prerender(): string[] {
  return ['/hello', ...names.map((name) => `/hello/${name}`)]
}
