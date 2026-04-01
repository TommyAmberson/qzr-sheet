/**
 * Roster CSV parsing and serialization.
 *
 * Supported import formats:
 *   1. Simple 4-column:  Division,Team,Quizzer,Church
 *   2. Legacy 8-column from the tournament spreadsheet:
 *        Division,Teams,(junk),(derived),Team,Quizzer,Church,(trailing)
 *      Left table (cols 0–1) is the authoritative Division→Team mapping.
 *      Right table (cols 4–6) holds the quizzer roster; division is resolved
 *      from the left table rather than trusting col 3 (often a VLOOKUP formula).
 *
 * Export always produces the simple 4-column format.
 * Rows with no Quizzer or no Team are skipped.
 */

export interface RosterEntry {
  division: string
  teamName: string
  quizzerName: string
  church: string
}

/** Split a CSV line into fields, honouring RFC-4180 quoting. */
function splitCsvRow(line: string): string[] {
  const fields: string[] = []
  let i = 0
  while (i <= line.length) {
    if (i === line.length) {
      fields.push('')
      break
    }
    if (line[i] === '"') {
      let j = i + 1
      let field = ''
      while (j < line.length) {
        if (line[j] === '"' && line[j + 1] === '"') {
          field += '"'
          j += 2
        } else if (line[j] === '"') {
          j++
          break
        } else {
          field += line[j]!
          j++
        }
      }
      fields.push(field)
      if (line[j] === ',') j++
      i = j
    } else {
      const end = line.indexOf(',', i)
      if (end === -1) {
        fields.push(line.slice(i))
        break
      }
      fields.push(line.slice(i, end))
      i = end + 1
    }
  }
  return fields
}

function trim(s: string): string {
  return s.trim().replace(/\u00A0/g, ' ')
}

export function parseRosterCsv(text: string): RosterEntry[] {
  const lines = text.split(/\r?\n/)
  if (lines.length === 0) return []

  const firstDataLine = lines.find((l) => l.trim()) ?? ''
  const firstFields = splitCsvRow(firstDataLine).map(trim)

  const isLegacy =
    firstFields.length >= 7 ||
    (/^division$/i.test(firstFields[0] ?? '') && /^teams$/i.test(firstFields[1] ?? ''))

  const startRow = /^division$/i.test(firstFields[0] ?? '') ? 1 : 0

  if (isLegacy) return parseLegacy(lines, startRow)
  return parseSimple(lines, startRow)
}

/** Parse the legacy 8-column spreadsheet export. */
function parseLegacy(lines: string[], startRow: number): RosterEntry[] {
  // Pass 1: build team→division map from the left table (cols 0–1)
  const teamDiv = new Map<string, string>()
  for (let i = startRow; i < lines.length; i++) {
    const fields = splitCsvRow(lines[i]!).map(trim)
    const division = fields[0] ?? ''
    const teamName = fields[1] ?? ''
    if (division && teamName) teamDiv.set(teamName, division)
  }

  // Pass 2: extract quizzers from the right table (cols 4–6)
  const entries: RosterEntry[] = []
  for (let i = startRow; i < lines.length; i++) {
    const fields = splitCsvRow(lines[i]!).map(trim)
    const teamName = fields[4] ?? ''
    const quizzerName = fields[5] ?? ''
    const church = fields[6] ?? ''
    if (!teamName || !quizzerName) continue
    entries.push({
      division: teamDiv.get(teamName) ?? '',
      teamName,
      quizzerName,
      church,
    })
  }
  return entries
}

/** Parse the simple 4-column format: Division,Team,Quizzer,Church */
function parseSimple(lines: string[], startRow: number): RosterEntry[] {
  const entries: RosterEntry[] = []
  for (let i = startRow; i < lines.length; i++) {
    const fields = splitCsvRow(lines[i]!).map(trim)
    const division = fields[0] ?? ''
    const teamName = fields[1] ?? ''
    const quizzerName = fields[2] ?? ''
    const church = fields[3] ?? ''
    if (!teamName || !quizzerName) continue
    entries.push({ division, teamName, quizzerName, church })
  }
  return entries
}

/** Quote a CSV field if it contains commas, double-quotes, or newlines. */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/** Serialize a roster to a simple 4-column CSV string. */
export function serializeRosterCsv(entries: RosterEntry[]): string {
  const header = 'Division,Team,Quizzer,Church'
  const rows = entries.map(
    (e) =>
      `${csvField(e.division)},${csvField(e.teamName)},${csvField(e.quizzerName)},${csvField(e.church)}`,
  )
  return [header, ...rows].join('\n')
}
