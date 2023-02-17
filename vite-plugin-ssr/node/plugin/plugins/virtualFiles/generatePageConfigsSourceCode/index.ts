export { generatePageConfigsSourceCode }
export { generatePageConfigVirtualFile }

import { assert } from '../../../utils'

import type { PageConfigData, PageConfigGlobal } from '../../../../../shared/page-configs/PageConfig'
import { generateEagerImport } from '../generateEagerImport'
import { loadPageConfigFiles } from './loadPageConfigFiles'
import { getPageConfigsData } from './getPageConfigsData'
import { virtualIdPageConfigCode } from './virtualIdPageConfigCode'
import { handleBuildError } from './handleBuildError'

let pageConfigsData: null | PageConfigData[] = null

// TODO: ensure that client-side of Server Routing loads less than Client Routing
// TODO: create one virtual file per route
// TODO: if conf isn't file path then assert that it's serialazable
// TODO: use Math.random() instead of timestamp in built file + think why I had concurrent issues

async function generatePageConfigsSourceCode(
  userRootDir: string,
  isForClientSide: boolean,
  isDev: boolean
): Promise<string> {
  try {
    return await getCode(userRootDir, isForClientSide)
  } catch (err) {
    handleBuildError(err, isDev)
    assert(false)
  }
}

async function getCode(userRootDir: string, isForClientSide: boolean): Promise<string> {
  const result = await loadPageConfigFiles(userRootDir)
  if ('err' in result) {
    return ['export const pageConfigs = null;', 'export const pageConfigGlobal = null;'].join('\n')
  }
  const { pageConfigFiles } = result
  const result2 = getPageConfigsData(pageConfigFiles, userRootDir)
  pageConfigsData = result2.pageConfigsData
  const { pageConfigGlobal } = result2
  return generateSourceCodeOfPageConfigs(pageConfigsData, pageConfigGlobal, isForClientSide)
}

function generateSourceCodeOfPageConfigs(
  pageConfigsData: PageConfigData[],
  pageConfigGlobal: PageConfigGlobal,
  isForClientSide: boolean
): string {
  const lines: string[] = []
  const importStatements: string[] = []

  lines.push('export const pageConfigs = [];')
  pageConfigsData.forEach((pageConfig, i) => {
    const { pageConfigFilePath, pageId2, routeFilesystem, configSources, codeFilesImporter } = pageConfig
    const pageConfigVar = `pageConfig${i + 1}` // TODO: remove outdated & unncessary variable creation
    lines.push(`{`)
    lines.push(`  const ${pageConfigVar} = {`)
    lines.push(`    pageId2: '${pageId2}',`)
    lines.push(`    pageConfigFilePath: '${pageConfigFilePath}',`)
    lines.push(`    routeFilesystem: '${routeFilesystem}',`)
    lines.push(`    codeFilesImporter: '${codeFilesImporter}',`)
    lines.push(`    loadCodeFiles: async () => (await import('${codeFilesImporter}')).default,`)
    lines.push(`    configSources: {`)
    Object.entries(configSources).forEach(([configName, configSource]) => {
      lines.push(`      ['${configName}']: {`)
      const { configFilePath, c_env } = configSource
      lines.push(`        configFilePath: '${configFilePath}',`)
      lines.push(`        c_env: '${c_env}',`)
      if ('configValue' in configSource) {
        const { configValue } = configSource
        lines.push(`        configValue: ${JSON.stringify(configValue)}`)
      } else if (configSource.codeFilePath) {
        const { codeFilePath, c_env } = configSource
        lines.push(`        codeFilePath: '${codeFilePath}',`)
        if (c_env === 'routing') {
          const { importVar, importStatement } = generateEagerImport(codeFilePath)
          // TODO: expose all exports so that assertDefaultExport() can be applied
          lines.push(`        configValue: ${importVar}.default`)
          importStatements.push(importStatement)
        }
      } else {
        assert(false)
      }
      lines.push(`      },`)
    })
    lines.push(`    }`)
    lines.push('  };')
    lines.push(`  pageConfigs.push(${pageConfigVar})`)
    lines.push(`}`)
  })

  lines.push('export const pageConfigGlobal = {')
  Object.entries(pageConfigGlobal).forEach(([configName, configValue]) => {
    lines.push(`['${configName}']: ${configValue}`)
  })
  lines.push('};')

  const code = [...importStatements, ...lines].join('\n')
  return code
}

function generatePageConfigVirtualFile(id: string, isForClientSide: boolean) {
  if (!id.startsWith(virtualIdPageConfigCode)) return
  const pageId = id.slice(virtualIdPageConfigCode.length)
  assert(pageConfigsData)
  const pageConfigData = pageConfigsData.find((pageConfigData) => pageConfigData.pageId2 === pageId)
  assert(pageConfigData)
  return generateSourceCodeOfLoadCodeFileVirtualFile(pageConfigData, isForClientSide)
}

function generateSourceCodeOfLoadCodeFileVirtualFile(pageConfigData: PageConfigData, isForClientSide: boolean): string {
  const lines: string[] = []
  const importStatements: string[] = []
  lines.push('export default [')
  let varCounter = 0
  Object.entries(pageConfigData.configSources).forEach(([configName, configSource]) => {
    if (!configSource.codeFilePath) return
    const { c_env, codeFilePath } = configSource
    if (c_env === (isForClientSide ? 'server-only' : 'client-only')) return
    const { importVar, importStatement } = generateEagerImport(codeFilePath, varCounter++)
    importStatements.push(importStatement)
    lines.push(`  {`)
    lines.push(`    configName: '${configName}',`)
    lines.push(`    codeFilePath: '${codeFilePath}',`)
    lines.push(`    codeFileExports: ${importVar}`)
    lines.push(`  },`)
  })
  lines.push('];')
  const code = [...importStatements, ...lines].join('\n')
  return code
}
