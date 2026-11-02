import { readonly, ref, type Ref } from 'vue'
import type { Router } from 'vue-router'
import { ERROR_PARAMS, socialSignInError, type SocialSignInError } from '@qzr/shared'

// One per page load, shared by its callers: the header for a failed sign-in,
// account settings for a failed connection.
let pending: Ref<SocialSignInError | null> | null = null

/** A failed GitHub/Google sign-in or connection returns with `?error=`. Read
 *  it once per page load, strip it through the router (a raw replaceState is
 *  undone by its next push, and Back would bring the message back), and hold
 *  it until `clear()`. */
export function useSocialSignInError(router: Router) {
  if (!pending) {
    pending = ref(socialSignInError(window.location.search))
    if (pending.value) {
      void router.isReady().then(() => {
        const query = { ...router.currentRoute.value.query }
        for (const param of ERROR_PARAMS) delete query[param]
        return router.replace({ query })
      })
    }
  }
  const state = pending
  return {
    error: readonly(state),
    /** Forget the error once dismissed, so a later sign-out doesn't repeat it. */
    clear: () => {
      state.value = null
    },
  }
}
