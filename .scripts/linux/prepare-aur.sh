#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
output_dir="${1:?output directory required}"

cd "$repo_root"
pkgver="$(
  (git describe --long --tags --abbrev=7 2>/dev/null || :) \
    | sed 's/^v//;s/\([^-]*-g\)/r\1/;s/-/./g'
)"
if [[ -z $pkgver ]]; then
  pkgver="0.1.0.r$(git rev-list --count HEAD).g$(git rev-parse --short=7 HEAD)"
fi

mkdir -p "$output_dir"
install -m 0644 "$script_dir/PKGBUILD" "$output_dir/PKGBUILD"
sed -i "s/^pkgver=.*/pkgver=${pkgver}/" "$output_dir/PKGBUILD"
grep -Fxq "pkgver=${pkgver}" "$output_dir/PKGBUILD"

echo "Prepared home-assistant-tui-git ${pkgver} in ${output_dir}"
