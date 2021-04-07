import { renderToString } from '@vue/server-renderer'
import { html } from 'vite-plugin-ssr'
import { createApp } from './app'
import { PageProps, ContextProps } from './types'
import logoUrl from './logo.svg'

export { render }

async function render({
  Page,
  pageProps,
  contextProps
}: {
  Page: any
  pageProps: PageProps
  contextProps: ContextProps
}) {
  const app = createApp(Page, pageProps)
  const appHtml = await renderToString(app)
  const title = 'My Vite SSR app'
  return html`<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <link rel="icon" href="${logoUrl}" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${title}</title>
      </head>
      <body>
        <div id="app">${html.dangerouslySetHtml(appHtml)}</div>
      </body>
    </html>`
}
