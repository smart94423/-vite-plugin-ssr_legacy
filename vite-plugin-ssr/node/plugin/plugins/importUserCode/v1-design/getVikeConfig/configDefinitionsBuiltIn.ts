export { configDefinitionsBuiltIn }
export { configDefinitionsBuiltInGlobal }
export type { ConfigDefinition }
export type { ConfigNameGlobal }

import type { ConfigEnvPrivate, PageConfigData } from '../../../../../../shared/page-configs/PageConfig.js'
import type { ConfigNameBuiltIn, ConfigNamePrivate } from '../../../../../../shared/page-configs/Config.js'
import { getConfigEnv, isConfigSet } from '../helpers.js'

type ConfigDefinition = {
  env: ConfigEnvPrivate
  effect?: (config: {
    configValue: unknown
    configDefinedAt: string
  }) => undefined | Record<string, Partial<ConfigDefinition>>
  _computed?: (pageConfig: PageConfigData) => unknown
}

type ConfigDefinitionsBuiltIn = Record<ConfigNameBuiltIn | ConfigNamePrivate, ConfigDefinition>
const configDefinitionsBuiltIn: ConfigDefinitionsBuiltIn = {
  onRenderHtml: {
    env: 'server-only'
  },
  onRenderClient: {
    env: 'client-only'
  },
  onHydrationEnd: {
    env: 'client-only'
  },
  onPageTransitionStart: {
    env: 'client-only'
  },
  onPageTransitionEnd: {
    env: 'client-only'
  },
  onBeforeRender: {
    env: 'server-only'
  },
  onBeforePrerenderStart: {
    env: 'server-only'
  },
  Page: {
    env: 'server-and-client'
  },
  passToClient: {
    env: 'server-only'
  },
  route: {
    env: '_routing-eager'
  },
  guard: {
    env: '_routing-lazy'
  },
  iKnowThePerformanceRisksOfAsyncRouteFunctions: {
    env: '_routing-eager'
  },
  filesystemRoutingRoot: {
    env: 'config-only'
  },
  client: {
    env: 'client-only'
  },
  clientRouting: {
    env: 'server-and-client' // TODO: config-only instead?
  },
  prerender: {
    env: 'config-only'
  },
  hydrationCanBeAborted: {
    env: 'client-only' // TODO: config-only instead?
  },
  prefetchStaticAssets: {
    env: 'client-only' // TODO: config-only instead?
  },
  extends: {
    env: 'config-only'
  },
  meta: {
    env: 'config-only'
  },
  isClientSideRenderable: {
    env: 'server-and-client',
    _computed: (pageConfig): boolean =>
      isConfigSet(pageConfig, 'onRenderClient') &&
      isConfigSet(pageConfig, 'Page') &&
      getConfigEnv(pageConfig, 'Page') !== 'server-only'
  },
  onBeforeRenderEnv: {
    env: 'client-only',
    _computed: (pageConfig): null | ConfigEnvPrivate =>
      !isConfigSet(pageConfig, 'onBeforeRender') ? null : getConfigEnv(pageConfig, 'onBeforeRender')
  }
}

type ConfigNameGlobal =
  | 'onPrerenderStart'
  | 'onBeforeRoute'
  | 'prerender'
  | 'extensions'
  | 'disableAutoFullBuild'
  | 'includeAssetsImportedByServer'
  | 'baseAssets'
  | 'baseServer'
  | 'redirects'
  | 'trailingSlash'
  | 'disableUrlNormalization'
const configDefinitionsBuiltInGlobal: Record<ConfigNameGlobal, ConfigDefinition> = {
  onPrerenderStart: {
    env: 'server-only'
  },
  onBeforeRoute: {
    env: '_routing-eager'
  },
  prerender: {
    env: 'config-only'
  },
  extensions: { env: 'config-only' },
  disableAutoFullBuild: { env: 'config-only' },
  includeAssetsImportedByServer: { env: 'config-only' },
  baseAssets: { env: 'config-only' },
  baseServer: { env: 'config-only' },
  redirects: { env: 'server-only' },
  trailingSlash: { env: 'server-only' },
  disableUrlNormalization: { env: 'server-only' }
}
