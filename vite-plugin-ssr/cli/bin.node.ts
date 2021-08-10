import { cac } from 'cac'
import { resolve } from 'path'
import { prerender } from '../prerender'
import { projectInfo } from '../utils'

const cli = cac(projectInfo.name)

cli
  .command('prerender')
  .option('--partial', 'allow only a subset of pages to be pre-rendered')
  .option(
    '--no-extra-dir',
    'Do not create a new directory for each page, e.g. generate `dist/client/about.html` instead of `dist/client/about/index.html`'
  )
  .option(
    '--root <path>',
    '[string] root directory of your project (where `vite.config.js` and `dist/` live) (default: `process.cwd()`)'
  )
  .option('--client-router', 'serialize `pageContext` to JSON files for Client-side Routing')
  .option('--base <path>', `[string] public base path (default: /)`)
  .action(async (options) => {
    const { partial, extraDir, clientRouter, base } = options
    const root = resolve(options.root)
    const noExtraDir = !extraDir
    await prerender({ partial, noExtraDir, clientRouter, base, root })
  })

// Listen to unknown commands
cli.on('command:*', () => {
  console.error('Invalid command: %s', cli.args.join(' '))
})

cli.help()
cli.version(projectInfo.version)

cli.parse(process.argv.length === 2 ? [...process.argv, '--help'] : process.argv)

process.on('unhandledRejection', (rejectValue) => {
  throw rejectValue
})
