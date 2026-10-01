import { readonly, ref } from 'vue'
import type { Router } from 'vue-router'
import { ERROR_PARAMS, socialSignInError } from '@qzr/shared'

/** A failed GitHub/Google sign-in returns with `?error=`. Read it, strip it
 *  through the router (a raw replaceState is undone by its next push, and Back
 *  would bring the message back), and hold it until `clear()`. Call once per
 *  page, from the header that owns the sign-in menus. */
export function useSocialSignInError(router: Router) {
  const pending = ref(socialSignInError(window.location.search))

  if (pending.value) {
    void router.isReady().then(() => {
      const query = { ...router.currentRoute.value.query }
      for (const param of ERROR_PARAMS) delete query[param]
      return router.replace({ query })
    })
  }

  return {
    error: readonly(pending),
    /** Forget the error once dismissed, so a later sign-out doesn't repeat it. */
    clear: () => {
      pending.value = null
    },
  }
}
