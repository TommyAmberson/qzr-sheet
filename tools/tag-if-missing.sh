#!/usr/bin/env bash
#
# Tag the current HEAD with the given annotated tag if it doesn't already
# exist. Designed to be called from multiple concurrent workflow runs
# against the same tag (e.g. shared@<v> tagged by deploy-api, deploy-web,
# and release-scoresheet in parallel) — fetch tags first to detect
# remote-already-exists, and tolerate a lost race on push.
#
# Usage: tools/tag-if-missing.sh <tag> <subject>
#
# Requires: origin remote configured, contents:write perms, and either
# git config user.{name,email} pre-set or this script invoked with them
# available in the environment.

set -euo pipefail

tag=$1
subject=$2

git fetch origin --tags --quiet || true

if git rev-parse --quiet --verify "refs/tags/${tag}" >/dev/null; then
	echo "Tag ${tag} already exists; skipping"
	exit 0
fi

git tag -a "${tag}" -m "${subject}"

if git push origin "${tag}"; then
	echo "Tagged ${tag} at $(git rev-parse HEAD)"
else
	echo "Push of ${tag} failed — likely lost the race to another workflow"
fi
