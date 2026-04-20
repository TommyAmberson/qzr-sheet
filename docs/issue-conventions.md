# Issue Conventions

How work is tracked in GitHub Issues for this repo.

## Where work lives

* **`ROADMAP.md`** — high-level ordered pointer to planned product work, with the suggested build
  order and a short backlog list
* **GitHub Issues** — detailed planning, refactor opportunities, bugs, and design questions
* **`CHANGELOG.md`** — log of what has actually shipped

If something is in `ROADMAP.md`, there is a corresponding issue with the `roadmap` label that holds
the detail. Don't expand `ROADMAP.md` with detail — write it in the issue.

## Labels

| Label            | Meaning                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `roadmap`        | Tracked in `ROADMAP.md` as planned product work                    |
| `claude-created` | Any GitHub content authored by Claude (issue, comment, review, PR) |
| `bug`            | Defect — something is not working as intended                      |
| `enhancement`    | Feature or improvement (use alongside `roadmap` for planned ones)  |

Standard GitHub labels (`good first issue`, `help wanted`, `question`, `wontfix`, etc.) are also
available.

## Titles

* Imperative or noun-phrase ("Add X", "Pre-group Y", "Schedule generation + schema")
* No phase-number prefixes — ordering lives in `ROADMAP.md`, not in titles
* Concrete and scoped — one issue, one piece of work (or one parent + sub-issues)

## Body structure

Most issues have:

1. **Background / problem** — what's wrong or what's missing, with code citations where useful
2. **Proposal** — concrete approach, including alternatives if there's a real choice to make
3. **Why deferred** — for refactor issues that aren't immediately actionable
4. **Files** — specific paths involved
5. **Footer** — required for Claude-authored content (see below)

Code paths and identifiers go in backticks. Line numbers use `path/to/file.ts:123` format.

## Cross-references

* **`Blocked by #N`** — plain text reference in the body; GitHub auto-links both directions
* **Sub-issues** — true parent/child hierarchy with progress bar (use
  `gh api -X POST /repos/{owner}/{repo}/issues/{N}/sub_issues -F sub_issue_id=...` or the web UI)

Example: `#9 Schedule` is a parent with sub-issues `#12`–`#16` for its phases. `#16` is also blocked
by `#7` (a separate issue from a different epic).

## AI attribution

Per `CLAUDE.md`, anything Claude writes on GitHub must be marked as AI-generated in two ways:

1. Apply the `claude-created` label
2. Append a footer line at the end of the body:
   * `_Created by Claude Code_` — for issues
   * `_Comment by Claude Code_` — for issue/PR comments
   * `🤖 Generated with [Claude Code](https://claude.ai/code)` — for code reviews (this is what the
     `/code-review:code-review` skill template emits)

Git commits are exempt — no `Co-Authored-By` trailers, and commit messages don't mention AI.

The exception: when the user and Claude have collaboratively drafted content and the user explicitly
says it's OK to skip the label/footer for that specific item.
