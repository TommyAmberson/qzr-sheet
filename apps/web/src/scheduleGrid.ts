/**
 * Schedule-grid helpers and types moved to `@qzr/ui` so the scoresheet
 * picker can render the same grid as the portal viewer. This file
 * re-exports for source compatibility — prefer importing from
 * `@qzr/ui` directly in new code.
 */
export {
  STATS_BREAK_LABEL,
  buildGrid,
  bySortOrder,
  formatSlotTime,
  groupRowsByDay,
  hasAnyQuiz,
  isStatsBreak,
  seatRef,
  seatTeam,
  sortedSeats,
} from '@qzr/ui'
export type {
  DayGroup,
  Grid,
  GridRow,
  MeetTeamRow as MeetTeamGridRow,
  PrelimAssignmentRow as PrelimAssignmentGridRow,
  ScheduleRoom,
  ScheduleSlot,
  ScheduledQuiz as GridScheduledQuiz,
  ScheduledSeat,
} from '@qzr/ui'
