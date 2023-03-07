export { assertClientEntryId }

import { getGlobalContext } from '../../globalContext'
import { assert, assertPosixPath, isNpmPackageModule } from '../../../utils'
import { isVirutalModulePageCodeFilesImporter } from '../../../commons/virtual-files/virtualIdPageCodeFilesImporter'

function assertClientEntryId(id: string) {
  assertPosixPath(id)
  assert(!id.startsWith('/@fs'), id)
  const isPkg = isNpmPackageModule(id)
  assert(
    // Client entry
    id.startsWith('@@vite-plugin-ssr/') ||
      // User files
      id.startsWith('/') ||
      // Code files importer
      isVirutalModulePageCodeFilesImporter(id) ||
      // Stem packages
      isPkg,
    id
  )
  if (isPkg) {
    const { configVps } = getGlobalContext()
    assert(configVps === null || configVps.extensions.some(({ npmPackageName }) => id.startsWith(npmPackageName)), id)
  }
}
