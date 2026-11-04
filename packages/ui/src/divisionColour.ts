import { divisionColour, type ScheduleDocument } from '@qzr/shared'
import './divisionColours.css'

/** A division's colour as the CSS value to draw it in, its own or by its place */
export const divisionColourVar = (doc: ScheduleDocument, division: string) =>
  `var(--dc-${divisionColour(doc, division)})`
