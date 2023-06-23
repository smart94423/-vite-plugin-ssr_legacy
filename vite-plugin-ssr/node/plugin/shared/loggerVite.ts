export { improveViteLogs }

import { assert, trimWithAnsi, trimWithAnsiTrailOnly } from '../utils'
import { isConfigInvalid } from '../../runtime/renderPage/isConfigInvalid'
import { logViteErrorContainingCodeSnippet, logViteAny, clearTheScreen } from './loggerNotProd'
import { isErrorWithCodeSnippet } from './loggerNotProd/errorWithCodeSnippet'
import { getHttpRequestAsyncStore } from './getHttpRequestAsyncStore'
import { removeSuperfluousViteLog } from './loggerVite/removeSuperfluousViteLog'
import type { LogType, ResolvedConfig, LogErrorOptions } from 'vite'
import { isErrorDebug } from './isErrorDebug'

function improveViteLogs(config: ResolvedConfig) {
  intercept('info', config)
  intercept('warn', config)
  intercept('error', config)
}

function intercept(logType: LogType, config: ResolvedConfig) {
  config.logger[logType] = (msg, options: LogErrorOptions = {}) => {
    assert(!isErrorDebug())

    if (removeSuperfluousViteLog(msg)) return

    if (!!options.timestamp) {
      msg = trimWithAnsi(msg)
    } else {
      // No timestamp => no "[vite]" tag prepended => we don't trim the beginning of the message
      msg = trimWithAnsiTrailOnly(msg)
    }

    const store = getHttpRequestAsyncStore()

    // Dedupe Vite error messages
    if (options.error && store?.shouldErrorBeSwallowed(options.error)) {
      return
    }
    // Remove this once https://github.com/vitejs/vite/pull/13495 is released
    if (msg.startsWith('Transform failed with ') && store && logType === 'error') {
      store.markErrorMessageAsLogged(msg)
      return
    }

    if (options.error && isErrorWithCodeSnippet(options.error)) {
      logViteErrorContainingCodeSnippet(options.error)
      return
    }

    if (options.clear && !isConfigInvalid) clearTheScreen({ clearIfFirstLog: true })
    if (options.error) store?.markErrorAsLogged(options.error)
    // Vite's default logger preprends the "[vite]" tag if and only if options.timestamp is true
    const prependViteTag = options.timestamp || !!store?.httpRequestId
    logViteAny(msg, logType, store?.httpRequestId ?? null, prependViteTag)
  }
}
