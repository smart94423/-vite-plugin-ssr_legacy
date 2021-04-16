import { renderToString } from '@vue/server-renderer'
import { html } from 'vite-plugin-ssr'
import { createApp } from './app'

export { render }
export { addContextProps }
export { passToClient }

const passToClient = ['INITIAL_STATE']

async function render({ contextProps }) {
  const { appHtml } = contextProps
  return html`<!DOCTYPE html>
    <html>
      <body>
        <div id="app">${html.dangerouslySetHtml(appHtml)}</div>
      </body>
    </html>`
}

async function addContextProps({ Page }) {
  const { app, store } = createApp({ Page })

  const appHtml = await renderToString(app)

  const INITIAL_STATE = store.state

  return {
    INITIAL_STATE,
    appHtml
  }
}
