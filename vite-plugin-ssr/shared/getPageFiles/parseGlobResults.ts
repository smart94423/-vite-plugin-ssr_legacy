export { parseGlobResults }

import { assert, hasProp, isCallable, isObject, cast, assertUsage } from '../utils'
import { assertExportValues } from './assertExports'
import { getPageFileObject, type PageFile } from './getPageFileObject'
import { fileTypes, type FileType } from './fileTypes'
import { getPageConfigsFromGlob, type PageConfig } from './getPageConfigsFromGlob'

function parseGlobResults(pageFilesExports: unknown): { pageFiles: PageFile[]; pageConfigs: PageConfig[] } {
  assert(hasProp(pageFilesExports, 'isGeneratedFile'), 'Missing `isGeneratedFile`.')
  assert(pageFilesExports.isGeneratedFile !== false, `vite-plugin-ssr was re-installed(/re-built). Restart your app.`)
  assert(pageFilesExports.isGeneratedFile === true, `\`isGeneratedFile === ${pageFilesExports.isGeneratedFile}\``)
  assert(hasProp(pageFilesExports, 'pageFilesLazy', 'object'))
  assert(hasProp(pageFilesExports, 'pageFilesEager', 'object'))
  assert(hasProp(pageFilesExports, 'pageFilesExportNamesLazy', 'object'))
  assert(hasProp(pageFilesExports, 'pageFilesExportNamesEager', 'object'))
  assert(hasProp(pageFilesExports.pageFilesLazy, '.page'))
  assert(
    hasProp(pageFilesExports.pageFilesLazy, '.page.client') || hasProp(pageFilesExports.pageFilesLazy, '.page.server')
  )
  assert(hasProp(pageFilesExports, 'pageFilesList', 'string[]'))
  assert(hasProp(pageFilesExports, 'pageConfigFiles', 'object'))
  assert(hasProp(pageFilesExports, 'pageCodeLoaders', 'object'))
  assert(hasProp(pageFilesExports, 'pageConfigsHaveError', 'boolean'))

  const pageConfigs = getPageConfigsFromGlob(pageFilesExports.pageConfigFiles, pageFilesExports.pageCodeLoaders)
  assert(pageFilesExports.pageConfigsHaveError === false) // if `pageConfigsHaveError === true` then call isValidPageConfigFile() in getPageConfigsFromGlob() throws error

  const pageFilesMap: Record<string, PageFile> = {}
  parseGlobResult(pageFilesExports.pageFilesLazy).forEach(({ filePath, pageFile, globValue }) => {
    pageFile = pageFilesMap[filePath] = pageFilesMap[filePath] ?? pageFile
    const loadModule = globValue
    assertLoadModule(loadModule)
    pageFile.loadFile = async () => {
      if (!('fileExports' in pageFile)) {
        pageFile.fileExports = await loadModule()
        assertExportValues(pageFile)
      }
    }
  })
  parseGlobResult(pageFilesExports.pageFilesExportNamesLazy).forEach(({ filePath, pageFile, globValue }) => {
    pageFile = pageFilesMap[filePath] = pageFilesMap[filePath] ?? pageFile
    const loadModule = globValue
    assertLoadModule(loadModule)
    pageFile.loadExportNames = async () => {
      if (!('exportNames' in pageFile)) {
        const moduleExports = await loadModule()
        // Vite 2 seems to choke following assertion: https://github.com/brillout/vite-plugin-ssr/issues/455
        assertUsage(
          'exportNames' in moduleExports,
          'You seem to be using Vite 2 but the latest vite-plugin-ssr versions only work with Vite 3'
        )
        assert(hasProp(moduleExports, 'exportNames', 'string[]'), pageFile.filePath)
        pageFile.exportNames = moduleExports.exportNames
      }
    }
  })
  // `pageFilesEager` contains `.page.route.js` files
  parseGlobResult(pageFilesExports.pageFilesEager).forEach(({ filePath, pageFile, globValue }) => {
    pageFile = pageFilesMap[filePath] = pageFilesMap[filePath] ?? pageFile
    const moduleExports = globValue
    assert(isObject(moduleExports))
    pageFile.fileExports = moduleExports
  })
  parseGlobResult(pageFilesExports.pageFilesExportNamesEager).forEach(({ filePath, pageFile, globValue }) => {
    pageFile = pageFilesMap[filePath] = pageFilesMap[filePath] ?? pageFile
    const moduleExports = globValue
    assert(isObject(moduleExports))
    assert(hasProp(moduleExports, 'exportNames', 'string[]'), pageFile.filePath)
    pageFile.exportNames = moduleExports.exportNames
  })

  pageFilesExports.pageFilesList.forEach((filePath) => {
    pageFilesMap[filePath] = pageFilesMap[filePath] ?? getPageFileObject(filePath)
  })

  const pageFiles = Object.values(pageFilesMap)
  pageFiles.forEach(({ filePath }) => {
    assert(!filePath.includes('\\'))
  })

  return { pageFiles, pageConfigs }
}

type GlobResult = { filePath: string; pageFile: PageFile; globValue: unknown }[]
function parseGlobResult(globObject: Record<string, unknown>): GlobResult {
  const ret: GlobResult = []
  Object.entries(globObject).forEach(([fileType, globFiles]) => {
    cast<FileType>(fileType)
    assert(fileTypes.includes(fileType))
    assert(isObject(globFiles))
    Object.entries(globFiles).forEach(([filePath, globValue]) => {
      const pageFile = getPageFileObject(filePath)
      assert(pageFile.fileType === fileType)
      ret.push({ filePath, pageFile, globValue })
    })
  })
  return ret
}

function assertLoadModule(globValue: unknown): asserts globValue is () => Promise<Record<string, unknown>> {
  assert(isCallable(globValue))
}
