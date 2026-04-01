import { describe, it, expect } from 'vitest'
import { parseRosterCsv, serializeRosterCsv, type RosterEntry } from '../rosterCsv'

describe('parseRosterCsv', () => {
  describe('simple 4-column format', () => {
    it('parses basic rows without a header', () => {
      const csv = 'A,Team1,Alice,Grace Church\nA,Team1,Bob,Grace Church'
      const result = parseRosterCsv(csv)
      expect(result).toEqual([
        { division: 'A', teamName: 'Team1', quizzerName: 'Alice', church: 'Grace Church' },
        { division: 'A', teamName: 'Team1', quizzerName: 'Bob', church: 'Grace Church' },
      ])
    })

    it('skips a header row when first field is "Division"', () => {
      const csv = 'Division,Team,Quizzer,Church\nA,Team1,Alice,GCC'
      const result = parseRosterCsv(csv)
      expect(result).toEqual([
        { division: 'A', teamName: 'Team1', quizzerName: 'Alice', church: 'GCC' },
      ])
    })

    it('header detection is case-insensitive', () => {
      const csv = 'DIVISION,TEAM,QUIZZER,CHURCH\nB,T2,Carol,FBC'
      const result = parseRosterCsv(csv)
      expect(result).toHaveLength(1)
      expect(result[0]!.quizzerName).toBe('Carol')
    })

    it('skips rows with no quizzer name', () => {
      const csv = 'A,Team1,,GCC\nA,Team1,Bob,GCC'
      const result = parseRosterCsv(csv)
      expect(result).toHaveLength(1)
      expect(result[0]!.quizzerName).toBe('Bob')
    })

    it('skips rows with no team name', () => {
      const csv = 'A,,Alice,GCC\nA,Team1,Bob,GCC'
      const result = parseRosterCsv(csv)
      expect(result).toHaveLength(1)
      expect(result[0]!.quizzerName).toBe('Bob')
    })

    it('returns empty array for empty input', () => {
      expect(parseRosterCsv('')).toEqual([])
    })

    it('returns empty array for blank lines only', () => {
      expect(parseRosterCsv('\n\n\n')).toEqual([])
    })

    it('handles CRLF line endings', () => {
      const csv = 'A,Team1,Alice,GCC\r\nA,Team1,Bob,GCC'
      const result = parseRosterCsv(csv)
      expect(result).toHaveLength(2)
    })

    it('trims whitespace from fields', () => {
      const csv = ' A , Team1 , Alice , GCC '
      const result = parseRosterCsv(csv)
      expect(result[0]).toEqual({
        division: 'A',
        teamName: 'Team1',
        quizzerName: 'Alice',
        church: 'GCC',
      })
    })

    it('normalizes non-breaking spaces to regular spaces', () => {
      const csv = 'A,Team\u00A01,Alice,GCC'
      const result = parseRosterCsv(csv)
      expect(result[0]!.teamName).toBe('Team 1')
    })

    it('handles missing trailing fields gracefully', () => {
      const csv = 'A,Team1,Alice'
      const result = parseRosterCsv(csv)
      expect(result[0]).toEqual({
        division: 'A',
        teamName: 'Team1',
        quizzerName: 'Alice',
        church: '',
      })
    })

    it('skips rows where quizzer is only whitespace', () => {
      const csv = 'A,Team1,   ,GCC\nA,Team1,Bob,GCC'
      const result = parseRosterCsv(csv)
      expect(result).toHaveLength(1)
      expect(result[0]!.quizzerName).toBe('Bob')
    })

    it('parses multiple divisions correctly', () => {
      const csv = 'A,Eagles,Alice,GCC\nB,Hawks,Bob,FBC\nA,Eagles,Carol,GCC'
      const result = parseRosterCsv(csv)
      expect(result).toHaveLength(3)
      expect(result[0]!.division).toBe('A')
      expect(result[1]!.division).toBe('B')
      expect(result[2]!.division).toBe('A')
    })

    it('handles a single data row with no trailing newline', () => {
      const csv = 'A,Team1,Alice,GCC'
      const result = parseRosterCsv(csv)
      expect(result).toHaveLength(1)
    })
  })

  describe('RFC-4180 quoted fields', () => {
    it('parses quoted fields containing commas', () => {
      const csv = 'A,Team1,Alice,"Grace, Community Church"'
      const result = parseRosterCsv(csv)
      expect(result[0]!.church).toBe('Grace, Community Church')
    })

    it('parses escaped double quotes inside quoted fields', () => {
      const csv = 'A,Team1,"Alice ""Ace""",GCC'
      const result = parseRosterCsv(csv)
      expect(result[0]!.quizzerName).toBe('Alice "Ace"')
    })

    it('does not support newlines inside quoted fields (split happens first)', () => {
      const csv = 'A,Team1,"Alice\nSmith",GCC'
      const result = parseRosterCsv(csv)
      // The parser splits by \n before processing quotes, so the quoted
      // newline breaks the row into two incomplete lines.
      expect(result[0]!.quizzerName).toBe('Alice')
      expect(result[0]!.church).toBe('')
    })
  })

  describe('legacy 8-column format', () => {
    it('detects legacy format with 7+ columns', () => {
      const csv = [
        'A,Eagles,,,Eagles,Alice,GCC,',
        'A,Eagles,,,Eagles,Bob,GCC,',
        'B,Hawks,,,Hawks,Carol,FBC,',
      ].join('\n')
      const result = parseRosterCsv(csv)
      expect(result).toEqual([
        { division: 'A', teamName: 'Eagles', quizzerName: 'Alice', church: 'GCC' },
        { division: 'A', teamName: 'Eagles', quizzerName: 'Bob', church: 'GCC' },
        { division: 'B', teamName: 'Hawks', quizzerName: 'Carol', church: 'FBC' },
      ])
    })

    it('detects legacy format by Division/Teams header', () => {
      const csv = ['Division,Teams,,,,,,', 'A,Eagles,,,Eagles,Alice,GCC,'].join('\n')
      const result = parseRosterCsv(csv)
      expect(result).toHaveLength(1)
      expect(result[0]!.division).toBe('A')
    })

    it('resolves division from left table, not right table', () => {
      // Left table says Eagles → A, right table col 3 might be wrong
      const csv = [
        'Division,Teams,junk,derived,Team,Quizzer,Church,trailing',
        'A,Eagles,x,WRONG,Eagles,Alice,GCC,x',
      ].join('\n')
      const result = parseRosterCsv(csv)
      expect(result[0]!.division).toBe('A')
    })

    it('skips legacy rows with no quizzer', () => {
      const csv = ['A,Eagles,,,Eagles,,GCC,', 'A,Eagles,,,Eagles,Alice,GCC,'].join('\n')
      const result = parseRosterCsv(csv)
      expect(result).toHaveLength(1)
    })

    it('skips legacy rows with no team in right table', () => {
      const csv = ['A,Eagles,,,,Alice,GCC,', 'A,Eagles,,,Eagles,Bob,GCC,'].join('\n')
      const result = parseRosterCsv(csv)
      expect(result).toHaveLength(1)
      expect(result[0]!.quizzerName).toBe('Bob')
    })

    it('resolves division as empty string for unknown teams', () => {
      const csv = ['A,Eagles,,,Unknown,Alice,GCC,'].join('\n')
      const result = parseRosterCsv(csv)
      expect(result[0]!.division).toBe('')
    })

    it('maps multiple teams to their correct divisions', () => {
      const csv = [
        'A,Eagles,,,Eagles,Alice,GCC,',
        'B,Hawks,,,Hawks,Bob,FBC,',
        'A,Eagles,,,Eagles,Carol,GCC,',
        'B,Hawks,,,Hawks,Dave,FBC,',
      ].join('\n')
      const result = parseRosterCsv(csv)
      expect(result).toHaveLength(4)
      expect(result[0]!.division).toBe('A')
      expect(result[1]!.division).toBe('B')
      expect(result[2]!.division).toBe('A')
      expect(result[3]!.division).toBe('B')
    })
  })
})

describe('serializeRosterCsv', () => {
  it('produces header + data rows', () => {
    const entries: RosterEntry[] = [
      { division: 'A', teamName: 'Team1', quizzerName: 'Alice', church: 'GCC' },
    ]
    const csv = serializeRosterCsv(entries)
    const lines = csv.split('\n')
    expect(lines[0]).toBe('Division,Team,Quizzer,Church')
    expect(lines[1]).toBe('A,Team1,Alice,GCC')
  })

  it('returns header only for empty entries', () => {
    expect(serializeRosterCsv([])).toBe('Division,Team,Quizzer,Church')
  })

  it('quotes fields containing commas', () => {
    const entries: RosterEntry[] = [
      { division: 'A', teamName: 'Team1', quizzerName: 'Alice', church: 'Grace, Community' },
    ]
    const csv = serializeRosterCsv(entries)
    expect(csv).toContain('"Grace, Community"')
  })

  it('escapes double quotes in fields', () => {
    const entries: RosterEntry[] = [
      { division: 'A', teamName: 'Team1', quizzerName: 'Alice "Ace"', church: 'GCC' },
    ]
    const csv = serializeRosterCsv(entries)
    expect(csv).toContain('"Alice ""Ace"""')
  })

  it('quotes fields containing newlines', () => {
    const entries: RosterEntry[] = [
      { division: 'A', teamName: 'Team1', quizzerName: 'Alice\nSmith', church: 'GCC' },
    ]
    const csv = serializeRosterCsv(entries)
    expect(csv).toContain('"Alice\nSmith"')
  })

  it('does not quote plain fields', () => {
    const entries: RosterEntry[] = [
      { division: 'A', teamName: 'Team1', quizzerName: 'Alice', church: 'GCC' },
    ]
    const csv = serializeRosterCsv(entries)
    expect(csv.split('\n')[1]).toBe('A,Team1,Alice,GCC')
  })

  it('preserves entry order', () => {
    const entries: RosterEntry[] = [
      { division: 'B', teamName: 'Hawks', quizzerName: 'Zara', church: 'FBC' },
      { division: 'A', teamName: 'Eagles', quizzerName: 'Alice', church: 'GCC' },
    ]
    const csv = serializeRosterCsv(entries)
    const lines = csv.split('\n')
    expect(lines[1]).toContain('Hawks')
    expect(lines[2]).toContain('Eagles')
  })
})

describe('round-trip', () => {
  it('parse → serialize → parse produces the same entries', () => {
    const original: RosterEntry[] = [
      { division: 'A', teamName: 'Eagles', quizzerName: 'Alice', church: 'Grace Church' },
      { division: 'A', teamName: 'Eagles', quizzerName: 'Bob', church: 'Grace Church' },
      { division: 'B', teamName: 'Hawks', quizzerName: 'Carol', church: 'First Baptist' },
    ]
    const csv = serializeRosterCsv(original)
    const parsed = parseRosterCsv(csv)
    expect(parsed).toEqual(original)
  })

  it('round-trips entries with special characters', () => {
    const original: RosterEntry[] = [
      { division: 'A', teamName: 'Team, One', quizzerName: 'Alice "Ace"', church: 'GCC' },
    ]
    const csv = serializeRosterCsv(original)
    const parsed = parseRosterCsv(csv)
    expect(parsed).toEqual(original)
  })
})
