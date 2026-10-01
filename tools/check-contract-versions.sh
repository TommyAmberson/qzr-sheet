#!/usr/bin/env bash
#
# Two-mode guard for the @qzr/shared contract package, and for the wider
# "a version bump needs a dated CHANGELOG section" rule.
#
# packages/shared is a contract across consumers (scoresheet PWA + Tauri client,
# web portal, API Worker). Its package.json version is the contract version;
# consumer changelogs must reference which contract version they ship.
#
# Modes:
#   pre-commit (default): run as part of the simple-git-hooks pre-commit
#     chain. Blocks
#     a) commits that touch packages/shared/src/ on a branch whose
#        packages/shared/package.json version still matches the version
#        where the branch left master. One bump per pull request covers
#        every shared change in it.
#     b) any package version bump (scoresheet, web, api, shared) without a
#        matching dated `## [X.Y.Z]` section in that package's staged
#        CHANGELOG. Catches "bumped package.json but left the entry under
#        [Unreleased]" before the deploy CI check has to.
#   --ci: blocks consumer deploy workflows when the consumer's CHANGELOG
#     doesn't reference the current @qzr/shared version for the version
#     being deployed. Catches "bumped shared but forgot to update the
#     consumer's '### Bundled contract' subsection."
#   --pr <base>: the PR-level twin of (a), run by CI against the base the
#     PR merges into. Catches a missing bump that skipped the hook
#     (`--no-verify`, or commits rewritten by rebase or cherry-pick, which
#     don't run pre-commit).
#
# Refactor that's truly a no-op? Bypass pre-commit with `--no-verify`, or
# the CI check by ensuring the consumer changelog explicitly notes that
# the contract version is unchanged from the previous release.
#
# See CONTRIBUTING.md "Contract package versioning" and "Releasing".

set -euo pipefail

MODE="${1:-pre-commit}"

SHARED_SRC="packages/shared/src"
SHARED_MANIFEST="packages/shared/package.json"
SHARED_CHANGELOG="packages/shared/CHANGELOG.md"

###############################################################################
# Helpers
###############################################################################

# Version a package.json declares at a git ref, or in the index when <ref>
# is empty. Anchored to the top-level "version" line so nested dep versions
# don't match. awk reads to EOF: an early-exiting reader would SIGPIPE
# `git show`, and pipefail would read that as a failure.
version_at() {
	local ref=$1
	local manifest=$2
	git show "$ref:$manifest" 2>/dev/null | awk '
		!v && /^  "version":/ { v = $0 }
		END { if (v) { n = split(v, part, "\""); print part[n - 1] } }
	'
}

# The commit where the current branch left master. Uses whichever of
# origin/master and master forked most recently, so a stale ref can't hide
# a bump master already made. Prints nothing if neither exists.
branch_base() {
	local base="" ref mb
	for ref in origin/master master; do
		git rev-parse -q --verify "$ref^{commit}" >/dev/null || continue
		mb=$(git merge-base HEAD "$ref" 2>/dev/null) || continue
		if [ -z "$base" ] || git merge-base --is-ancestor "$base" "$mb"; then
			base=$mb
		fi
	done
	echo "$base"
}

# True iff the CHANGELOG at <ref> (the index when empty) has a dated
# `## [X.Y.Z] - YYYY-MM-DD` section for <version>. Literal prefix match, so
# semver build metadata (`+`) isn't read as regex, then a trailing date.
changelog_has_section() {
	local ref=$1
	local changelog=$2
	local version=$3
	git show "$ref:$changelog" 2>/dev/null | awk -v ver="$version" '
		index($0, "## [" ver "] ") == 1 && $0 ~ /[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/ { found = 1 }
		END { exit !found }
	'
}

###############################################################################
# Mode 1: pre-commit
###############################################################################

# src/ touched, but the branch hasn't bumped shared since it left master.
# The bump may sit in this commit or any earlier one on the branch.
check_staged() {
	if ! git diff --cached --name-only | grep -q "^$SHARED_SRC/"; then
		return 0
	fi

	local base base_v
	base=$(branch_base)
	if [ -z "$base" ]; then
		# No master to compare against: fall back to this commit alone.
		if git diff --cached --unified=0 -- "$SHARED_MANIFEST" 2>/dev/null \
			| grep -qE '^\+  "version":'; then
			return 0
		fi
		base_v="(no master found)"
	else
		base_v=$(version_at "$base" "$SHARED_MANIFEST")
		[ "$(version_at "" "$SHARED_MANIFEST")" != "$base_v" ] && return 0
	fi

	cat >&2 <<EOF

  $SHARED_SRC/ has staged changes, but $SHARED_MANIFEST "version" is
  still $base_v, the version this branch started from.

  @qzr/shared is a contract package: its version is a compatibility signal
  across consumers (scoresheet, web, api). Bump it once on this branch if
  the change has any observable effect on wire format, file format, or
  shared types, with a dated CHANGELOG section. Later commits on the branch
  extend that section instead of bumping again.

  Refactor with no observable behaviour change? Bypass with --no-verify.

EOF
	return 1
}

# A staged bump of a package's "version" must come with a dated section for
# the new version in that package's staged CHANGELOG.
check_version_promotion() {
	local manifest=$1
	local changelog=$2
	local new_version

	# Anchored to the top-level "version" line, as in check_staged.
	new_version=$(git diff --cached --unified=0 -- "$manifest" 2>/dev/null \
		| sed -nE 's/^\+  "version": "([^"]+)".*/\1/p')
	if [ -z "$new_version" ]; then
		return 0
	fi

	if changelog_has_section "" "$changelog" "$new_version"; then
		return 0
	fi

	cat >&2 <<EOF

  $manifest bumps "version" to $new_version, but $changelog has no
  dated "## [$new_version] - YYYY-MM-DD" section staged.

  Promote the [Unreleased] entries to a dated section for $new_version in
  the same commit. See CONTRIBUTING.md "Releasing".

EOF
	return 1
}

###############################################################################
# Mode 2: --ci
###############################################################################

json_version() {
	node -p "require('./$1').version"
}

# Extract the section of a Keep-a-Changelog file for a specific version.
# Matches '## [<version>]' or '## <version>' (the historical scoresheet
# entries use the unbracketed form).
changelog_section() {
	local file=$1
	local version=$2
	awk -v ver="$version" '
		$0 ~ "^## \\[?" ver "\\]?( |$)" { flag=1; next }
		$0 ~ "^## " && flag { exit }
		flag { print }
	' "$file"
}

check_changelog() {
	local consumer_name=$1
	local consumer_version=$2
	local changelog=$3
	local shared_v=$4

	if [ ! -f "$changelog" ]; then
		echo "::error::$changelog missing" >&2
		return 1
	fi

	local section
	section=$(changelog_section "$changelog" "$consumer_version")
	if [ -z "$section" ]; then
		echo "::error::$changelog has no entry for [$consumer_version]" >&2
		return 1
	fi

	if ! echo "$section" | grep -qE "@qzr/shared@$shared_v"; then
		echo "::error::$changelog [$consumer_version] doesn't reference @qzr/shared@$shared_v under '### Bundled contract'" >&2
		return 1
	fi
	return 0
}

###############################################################################
# Mode 3: --pr
###############################################################################

# PR-level twin of check_staged: <base> is the commit the PR merges into,
# HEAD the PR (in CI, the merge of the two).
check_pr_bump() {
	local base=$1

	if git diff --quiet "$base" HEAD -- "$SHARED_SRC"; then
		return 0
	fi

	local base_v head_v
	base_v=$(version_at "$base" "$SHARED_MANIFEST")
	head_v=$(version_at HEAD "$SHARED_MANIFEST")
	if [ "$head_v" = "$base_v" ]; then
		echo "::error::$SHARED_SRC changed but $SHARED_MANIFEST is still $base_v; bump it once in this PR" >&2
		return 1
	fi
	if ! changelog_has_section HEAD "$SHARED_CHANGELOG" "$head_v"; then
		echo "::error::$SHARED_CHANGELOG has no dated [$head_v] section" >&2
		return 1
	fi
	echo "  shared: $base_v -> $head_v, changelog dated. OK."
}

###############################################################################
# Dispatch
###############################################################################

failed=0
case "$MODE" in
	pre-commit)
		check_staged || failed=1
		check_version_promotion apps/scoresheet/package.json apps/scoresheet/CHANGELOG.md || failed=1
		check_version_promotion apps/web/package.json apps/web/CHANGELOG.md || failed=1
		check_version_promotion packages/api/package.json packages/api/CHANGELOG.md || failed=1
		check_version_promotion packages/shared/package.json packages/shared/CHANGELOG.md || failed=1
		;;
	--ci)
		consumer="${2:-}"
		if [ -z "$consumer" ]; then
			echo "Usage: $0 --ci <api|web|scoresheet>" >&2
			exit 2
		fi

		shared_v=$(json_version packages/shared/package.json)

		case "$consumer" in
			api)
				consumer_v=$(json_version packages/api/package.json)
				changelog=packages/api/CHANGELOG.md
				;;
			web)
				consumer_v=$(json_version apps/web/package.json)
				changelog=apps/web/CHANGELOG.md
				;;
			scoresheet)
				consumer_v=$(json_version apps/scoresheet/package.json)
				changelog=apps/scoresheet/CHANGELOG.md
				;;
			*)
				echo "Unknown consumer: $consumer. Choose api | web | scoresheet" >&2
				exit 2
				;;
		esac

		echo "  Current contract: @qzr/shared@$shared_v"
		echo "  Verifying $changelog [$consumer_v] references @qzr/shared@$shared_v…"
		check_changelog "$consumer" "$consumer_v" "$changelog" "$shared_v" || failed=1

		if [ "$failed" -eq 0 ]; then
			echo "  OK."
		fi
		;;
	--pr)
		base="${2:-}"
		if [ -z "$base" ]; then
			echo "Usage: $0 --pr <base-ref>" >&2
			exit 2
		fi
		check_pr_bump "$base" || failed=1
		;;
	*)
		echo "Usage: $0 [pre-commit | --ci <api|web|scoresheet> | --pr <base-ref>]" >&2
		exit 2
		;;
esac

exit "$failed"
