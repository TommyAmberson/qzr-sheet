import type { ScheduleDocument, SlotTime } from '@qzr/shared'

/**
 * The slot a display opens at: of the slots holding a quiz shown, the last to have started by now,
 * which stays the one until the next starts. None before the first has started.
 */
export function currentSlot(
  doc: ScheduleDocument,
  times: Map<string, SlotTime>,
  now: number,
): string | null {
  const slots = new Set(doc.quizzes.flatMap((quiz) => (quiz.cell ? [quiz.cell.slot] : [])))
  let current: { id: string; start: number } | null = null
  for (const id of slots) {
    const start = times.get(id)?.start
    if (start === undefined || start > now) continue
    if (!current || start > current.start) current = { id, start }
  }
  return current?.id ?? null
}
