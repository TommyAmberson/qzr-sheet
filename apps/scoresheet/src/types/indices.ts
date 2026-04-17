/**
 * Indexing conventions in qzr-sheet.
 *
 * The codebase uses two distinct ways to refer to a quizzer, and confusing them
 * is easy if you only read function signatures:
 *
 *  - SeatIdx: a 0-based position on a team's quiz bench or reserve. Seats 0-3
 *    are the four active quizzers sitting on the quiz bench, ready to jump up
 *    to answer. Seat 4 is the reserve — a 5th quizzer (if any) who is off the
 *    platform with the coaches, sitting out until subbed in. A seat's occupant
 *    can change when a substitution happens. Most of the app (live scoring,
 *    validation, scoring computation) works in SeatIdx space. Think of SeatIdx
 *    as "whoever is currently in this seat."
 *
 *  - QuizzerId: a stable numeric identity for a specific person. Immutable for
 *    the life of the quiz. Answers in the store are keyed by QuizzerId, so
 *    they correctly follow a quizzer when they move seats. QuizzerId appears
 *    mainly at the store boundary and in serialized quiz files.
 *
 * Numeric display convention:
 *
 *  All of the *Idx types are 0-BASED INTERNAL indices. When we display values
 *  to users we say "Team 1, Seat 1" — convert with `+ 1` locally at the
 *  template string, e.g. `Team ${teamIdx + 1}`. There is no separate
 *  "TeamNumber" branded type; the 1-based form only exists in user-facing
 *  strings and is never stored.
 *
 * Branded types catch these mistakes at compile time:
 *  - Passing a SeatIdx where a TeamIdx is expected (or vice versa)
 *  - Passing a raw 1-based number where a 0-based *Idx is expected
 *  - Passing a QuizzerId where a SeatIdx is expected
 */

declare const TeamIdxBrand: unique symbol
declare const SeatIdxBrand: unique symbol
declare const ColIdxBrand: unique symbol
declare const QuizzerIdBrand: unique symbol

/** 0-based index into the teams array. Immutable for the life of a quiz. */
export type TeamIdx = number & { readonly [TeamIdxBrand]: void }
/** 0-based index into a team's seat array. May contain a different quizzer after a substitution. */
export type SeatIdx = number & { readonly [SeatIdxBrand]: void }
/** 0-based index into the `columns` array. Stable for a given quiz. */
export type ColIdx = number & { readonly [ColIdxBrand]: void }
/** Stable numeric identity of a quizzer. Immutable — survives seat changes. */
export type QuizzerId = number & { readonly [QuizzerIdBrand]: void }

/** Cast a plain number to a TeamIdx. Use at boundaries where 0-based semantics are known. */
export const toTeamIdx = (n: number): TeamIdx => n as TeamIdx
/** Cast a plain number to a SeatIdx. Use at boundaries where 0-based semantics are known. */
export const toSeatIdx = (n: number): SeatIdx => n as SeatIdx
/** Cast a plain number to a ColIdx. Use at boundaries where 0-based semantics are known. */
export const toColIdx = (n: number): ColIdx => n as ColIdx
/** Cast a plain number to a QuizzerId. Use when reading an id from the store or a quiz file. */
export const toQuizzerId = (n: number): QuizzerId => n as QuizzerId
