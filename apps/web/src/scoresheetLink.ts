import { phone } from './viewport'

// Attributes for the portal's links to the scoresheet, bound with `v-bind`. On a desktop it opens
// in a new tab, so the portal page stays open to come back to; a phone has no room for tabs side by
// side, so it opens in place.
export const scoresheetLink: { target?: string } = phone ? {} : { target: '_blank' }
