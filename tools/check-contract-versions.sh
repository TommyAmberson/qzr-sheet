#!/usr/bin/env bash
#
# Two-mode guard for the @qzr/shared contract package.
#
# packages/shared is a contract across consumers (scoresheet PWA + Tauri client,
# web portal, API Worker). Its package.json version is the contract version;
# consumer changelogs must reference which contract version they ship.
#
# Modes:
#   pre-commit (default): blocks commits that touch packages/shared/src/
#     without a matching packages/shared/package.json version bump. Run as
#     part of the simple-git-hooks pre-commit chain.
#   --ci: blocks consumer deploy workflows when the consumer's CHANGELOG
#     doesn't reference the current @qzr/shared version for the version
#     being deployed. Catches "bumped shared but forgot to update the
#     consumer's '### Bundled contract' subsection."
#
# Refactor that's truly a no-op? Bypass pre-commit with `--no-verify`, or
# the CI check by ensuring the consumer changelog explicitly notes that
# the contract version is unchanged from the previous release.
#
# See CLAUDE.md "Contract package versioning".

set -euo pipefail

MODE="${1:-pre-commit}"

###############################################################################
# Mode 1: pre-commit
###############################################################################

check_staged() {
	local src="packages/shared/src"
	local manifest="packages/shared/package.json"

	if ! git diff --cached --name-only | grep -q "^$src/"; then
		return 0
	fi

	# Match a staged "version" key change in the manifest. Anchored to the
	# top-level "version" line so nested dep version edits don't satisfy
	# the check.
	if git diff --cached --unified=0 -- "$manifest" 2>/dev/null \
		| grep -qE '^\+  "version":'; then
		return 0
	fi

	cat >&2 <<EOF

  $src/ has staged changes but $manifest "version" is unchanged.

  @qzr/shared is a contract package — its version is a compatibility signal
  across consumers (scoresheet, web, api). Bump it if this change has any
  observable effect on wire format, file format, or shared types, and add a
  CHANGELOG entry.

  Refactor with no observable behaviour change? Bypass with --no-verify.

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
# Dispatch
###############################################################################

failed=0
case "$MODE" in
	pre-commit)
		check_staged || failed=1
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
	*)
		echo "Usage: $0 [pre-commit | --ci <api|web|scoresheet>]" >&2
		exit 2
		;;
esac

exit "$failed"
