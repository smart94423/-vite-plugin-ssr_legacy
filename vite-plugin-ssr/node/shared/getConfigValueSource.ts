export { getConfigValueSource }
export { getConfigValueSourcesRelevant }

import { ConfigValueSource, PageConfigData } from '../../shared/page-configs/PageConfig.js'
import { assert, assertIsNotBrowser } from './utils.js'
assertIsNotBrowser()

function getConfigValueSource(pageConfig: PageConfigData, configName: string): null | ConfigValueSource {
  // Doesn't exist on the client-side, but we are on the server-side as attested by assertIsNotBrowser()
  assert(pageConfig.configValueSources)
  const sources = pageConfig.configValueSources[configName]
  if (!sources) return null
  const configValueSource = sources[0]
  assert(configValueSource)
  return configValueSource
}
function getConfigValueSourcesRelevant(pageConfig: PageConfigData): (ConfigValueSource & { configName: string })[] {
  const configValueSourcesRelevant = Object.entries(pageConfig.configValueSources).map(([configName, sources]) => {
    const configValueSource = sources[0]
    assert(configValueSource)
    return { configName, ...configValueSource }
  })
  return configValueSourcesRelevant
}
