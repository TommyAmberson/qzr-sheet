/** How a revision of a stored quiz was saved */
export const RESULT_ACTIONS = ['submitted', 'uploaded', 'edited', 'merged', 'restored'] as const
export type ResultAction = (typeof RESULT_ACTIONS)[number]
