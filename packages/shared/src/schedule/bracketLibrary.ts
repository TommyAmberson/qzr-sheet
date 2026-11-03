/**
 * The bracket library (FR-029), transcribed from specs/005-schedule-redesign/bracket-library.md.
 * Each bracket is written for a lane of `n` teams: a number is a seed, the lane's `n`th best team;
 * `2A` is 2nd of quiz A; `N8` is New 8, from the bracket's own rerank X. Quizzes are lettered A, B,
 * … in the order listed unless named; the deciding quiz comes last.
 */
export interface BracketEntry {
  quizzes: { name: string; seats: string[] }[]
  deciding: string[]
}

type Written = (string | [name: string, seats: string])[]

function bracket(quizzes: Written, deciding: string): BracketEntry {
  let letter = 0
  return {
    quizzes: quizzes.map((q) => {
      const [name, seats] = typeof q === 'string' ? [String.fromCharCode(65 + letter++), q] : q
      return { name, seats: seats.split(/\s+/) }
    }),
    deciding: deciding.split(/\s+/),
  }
}

const NINE_LATER = ['1A 1C 2B', '1B 2A 2C', '3A 3B 3C', '3D 3E 1F', '2D 2E 1G']

/** Library entries by key: the team count, with `9b` the 9-team bracket in rule-book Bracket B order */
export const BRACKET_LIBRARY: Record<string, BracketEntry> = {
  '5': bracket(
    ['1 3 5', '2 4 2A', '3A 2B 3B', '1B 1A 1C', '2C 3C 3D', '2D 1E 2E', '3E 2F 3F'],
    '1F 1D 1G',
  ),
  '6': bracket(
    ['1 4 5', '2 3 6', '2A 2B 3A', '1A 1B 1C', '2C 3C 3B', '1E 2D 3D', '2F 3F 2E'],
    '1D 1F 1G',
  ),
  '7': bracket(
    ['1 5 7', '2 4 6', '3 2A 2B', '1B 1A 1C', '3A 3B 3C', '2C 2E 3E', '1E 2D 3D', '1F 2G 3G'],
    '1G 1D 1H',
  ),
  '8': bracket(
    ['1 4 8', '2 5 7', '3 6 3A', '1A 1C 2B', '1B 2A 2C', '3B 3C 3D', '1F 3E 2F', '2D 2E 1G'],
    '1D 1E 1H',
  ),
  '9': bracket(['1 6 7', '2 5 8', '3 4 9', ...NINE_LATER], '1D 1E 1H'),
  '9b': bracket(['1 4 9', '2 5 7', '3 6 8', ...NINE_LATER], '1D 1E 1H'),
  '10': bracket(
    [
      ['X', '8 9 10'],
      ['A', '1 4 N8'],
      ['B', '2 5 7'],
      ['C', '3 6 N9'],
      ['D', '1A 1C 2B'],
      ['E', '1B 2A 2C'],
      ['F', '3A 3B 3C'],
      ['G', '3F 2F N10'],
      ['H', '3D 3E 1F'],
      ['I', '2D 2E 1H'],
    ],
    '1D 1E 1I',
  ),
  '11': bracket(
    [
      ['X', '9 10 11'],
      ['A', '1 4 1X'],
      ['B', '2 5 7'],
      ['C', '3 6 8'],
      ['D', '1A 1C 2B'],
      ['E', '1B 2A 2C'],
      ['F', '3A 3B 3C'],
      ['G', '2F 2X 3X'],
      ['H', '3D 3E 1F'],
      ['I', '2D 2E 1H'],
    ],
    '1D 1E 1I',
  ),
  '12': bracket(
    [
      '1 5 12',
      '2 6 11',
      '3 7 10',
      '4 8 9',
      '1A 1B 1C',
      '2A 2B 2C',
      '3B 2D 3A',
      '2F 3D 3C',
      '2E 1D 1F',
      '3I 1G 1H',
      '3E 2I 1J',
    ],
    '1E 1I 1K',
  ),
  '14': bracket(
    [
      '12 13 14',
      '1 5 11',
      '2 6 10',
      '3 7 9',
      '4 8 1A',
      '1B 1C 1D',
      '2B 2C 2D',
      '3C 2E 3B',
      '2G 3E 3D',
      '2F 1E 1G',
      '3J 1H 1I',
      '3F 2J 1K',
      '2A 3H 3A',
      '3I 3G 3M',
      '1N 2H 2M',
      '2I 1O 1M',
    ],
    '1F 1J 1L',
  ),
  // The rule book's 9-team brackets (docs/rules.md); the org plays no "win twice" series, so each
  // ends at its first championship quiz
  ruleA: bracket(['1 2 3', '4 5 6', '7 8 9', '2A 3A 1B', '2B 3B 1C', '2D 3D 1E'], '1A 1D 1F'),
  ruleB: bracket(['1 4 9', '2 5 7', '3 6 8', ...NINE_LATER], '1D 1E 1H'),
  ruleC: bracket(
    [
      '1 4 9',
      '2 5 7',
      '3 6 8',
      '1A 1B 1C',
      '2A 2B 2C',
      '3A 3B 3C',
      '2D 3D 1E',
      '2E 3E 1F',
      '2G 3G 1H',
    ],
    '1D 1G 1I',
  ),
}
