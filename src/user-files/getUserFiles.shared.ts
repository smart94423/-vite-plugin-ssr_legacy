import { assert, assertUsage, slice } from '../utils'
import { getAllUserFiles, FileType } from './infra.shared'

export { getUserFiles }
export { getUserFile }

type UserFile = {
  filePath: string
  loadFile: () => Promise<Record<string, any>>
}

type AllUserFiles = Record<
  FileType,
  Record<UserFile['filePath'], UserFile['loadFile']>
>

async function getUserFiles(fileType: FileType): Promise<UserFile[]> {
  const allUserFiles: AllUserFiles = await getAllUserFiles()

  assertExtensions(allUserFiles)

  const userFiles = Object.entries(allUserFiles[fileType]).map(
    ([filePath, loadFile]) => {
      return { filePath, loadFile }
    }
  )

  return userFiles
}

async function getUserFile(
  fileType: FileType,
  pageId: string
): Promise<null | UserFile> {
  const userFiles = await getUserFiles(fileType)
  const userFile = findPageFile(userFiles, pageId)
  if (userFile === null) {
    return null
  }
  return userFile
}

function findPageFile<T>(
  userFiles: { filePath: string; loadFile: T }[],
  pageId: string
): { filePath: string; loadFile: T } | null {
  userFiles = userFiles.filter(({ filePath }) => filePath.startsWith(pageId))
  if (userFiles.length === 0) {
    return null
  }
  assertUsage(
    userFiles.length === 1,
    'Conflicting ' + userFiles.map(({ filePath }) => filePath).join(' ')
  )
  return userFiles[0]
}

function assertExtensions(allUserFiles: AllUserFiles) {
  ;['client', 'server', 'route'].forEach((ext) => {
    const fileExt = `.page.${ext}` as
      | '.page.client'
      | '.page.server'
      | '.page.route'
    Object.keys(allUserFiles[fileExt] || {}).forEach((filePath) => {
      const fileExt = slice(filePath.split('.'), -3, -1)
      assertUsage(
        fileExt[0] === 'page' && fileExt[1] === ext,
        `The file ${filePath} should be name \`*.page.${ext}.*\`. Add the missing \`.page\`.`
      )
    })
  })
}
