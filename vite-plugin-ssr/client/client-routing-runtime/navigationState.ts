import { getCurrentUrl, getGlobalObject } from '../server-routing-runtime/utils'
const globalObject = getGlobalObject<{ navigationChanged?: true }>('navigationState.ts', {})

const urlFirst = getCurrentUrl()

export const navigationState = {
  markNavigationChange() {
    globalObject.navigationChanged = true
  },
  get noNavigationChangeYet() {
    return !globalObject.navigationChanged && this.isFirstUrl(getCurrentUrl())
  },
  isFirstUrl(url: string) {
    return url === urlFirst
  }
}
