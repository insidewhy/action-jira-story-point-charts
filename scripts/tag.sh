#!/usr/bin/env bash

pnpm &>/dev/null build
if ! git diff --quiet; then
  echo >&2 git status is dirty, please commit files
  exit 1
fi

thisdir="$(dirname $0)"
version=v$(jq -r .version $thisdir/../package.json)
minor=${version%.*}
major=${minor%.*}

echo tagging $major $minor $version
git tag -f $major
git tag -f $minor
git tag -f $version
