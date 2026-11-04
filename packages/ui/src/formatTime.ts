/** The browser's time zone, which a meet's days are in when the API places them in time */
export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

/** "8:00 AM": an ISO instant as a local time of day */
export function formatSlotTime(startAt: string): string {
  const d = new Date(startAt)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** "Nov 2, 2026, 8:00 PM": an ISO instant as a local date and time, or nothing when it isn't one */
export function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
