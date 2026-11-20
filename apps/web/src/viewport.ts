// Whether the page opened at phone width: the breakpoint where the header switches to its phone
// menu. Keep it in step with the header's `.nav--desktop` media query.
export const phone =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(max-width: 767px)').matches
