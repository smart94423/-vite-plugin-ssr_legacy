export { extractExportNamesPlugin }
export { isUsingClientRouter }
export { extractExportNamesRE }

import type { Plugin, ResolvedConfig } from 'vite'
import { isSSR_options } from '../utils'
import { removeSourceMap, getExportNames } from '../helpers'
import { createDebugger, isDebugEnabled } from '../../utils'
const extractExportNamesRE = /(\?|&)extractExportNames(?:&|$)/
const debugNamespace = 'vps:extractExportNames'
const debug = createDebugger(debugNamespace)
const debugEnabled = isDebugEnabled(debugNamespace)

function extractExportNamesPlugin(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'vite-plugin-ssr:extractExportNames',
    enforce: 'post',
    async transform(src, id, options) {
      const { isProduction } = config
      const isClientSide = !isSSR_options(options)
      if (extractExportNamesRE.test(id)) {
        const code = await getExtractExportNamesCode(src, isClientSide, isProduction)
        debug('id:', id, '\nresult:\n' + code.code.trim(), '\nsrc:\n' + src.trim())
        return code
      }
    },
    configResolved(config_) {
      config = config_
    },
    config() {
      if (debugEnabled) {
        return { logLevel: 'silent' }
      }
    },
  } as Plugin
}

async function getExtractExportNamesCode(src: string, isClientSide: boolean, isProduction: boolean) {
  const { exportNames } = await getExportNames(src)
  if (isClientSide) {
    checkIfClientRouting(exportNames)
  }
  const code = getCode(exportNames, isClientSide, isProduction)
  return removeSourceMap(code)
}

function getCode(exportNames: string[], isClientSide: boolean, isProduction: boolean) {
  let code = ''
  code += '\n'
  code += `export const exportNames = [${exportNames.map((n) => JSON.stringify(n)).join(', ')}];`
  code = injectHmr(code, isClientSide, isProduction)
  return code
}

function injectHmr(code: string, isClientSide: boolean, isProduction: boolean) {
  if (isProduction) {
    return code
  }

  if (isClientSide) {
    code += '\n'
    code += `if (import.meta.hot) import.meta.hot.accept((mod) => { exportNames.length=0; exportNames.push(...mod.exportNames); });`
  } else {
    // Ensure Vite considers the module as `isSelfAccepting`. (Needed because Vite's module graph erroneously conflates the Vite server-side modules with their client-side counterparts.)
    code += '\n'
    code += 'if(false){import.meta.hot.accept(()=>{})};'
  }

  return code
}

var usesClientRouter: undefined | true
function checkIfClientRouting(exportNames: string[]) {
  if (exportNames.includes('clientRouting')) {
    usesClientRouter = true
  }
}
function isUsingClientRouter(): boolean {
  return usesClientRouter === true
}
