#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
release_version="${1:?release version required}"
output_dir="${2:?output directory required}"

[[ "$release_version" =~ ^[0-9]{8}\.[0-9]+$ ]] || {
  echo "Invalid release version: $release_version" >&2
  exit 1
}

mkdir -p "$output_dir"
gh release download "$release_version" \
  --repo timmo001/home-assistant-tui \
  --pattern SHA256SUMS \
  --dir "$output_dir"

checksum() {
  local asset="$1"
  awk -v asset="$asset" '$2 == asset { print $1 }' "$output_dir/SHA256SUMS"
}

x86_archive="home-assistant-tui-${release_version}-linux-x86_64.tar.gz"
arm_archive="home-assistant-tui-${release_version}-linux-aarch64.tar.gz"
x86_checksum="$(checksum "$x86_archive")"
arm_checksum="$(checksum "$arm_archive")"
[[ "$x86_checksum" =~ ^[0-9a-f]{64}$ && "$arm_checksum" =~ ^[0-9a-f]{64}$ ]] || {
  echo "Release checksums are missing or invalid" >&2
  exit 1
}

install -m 0644 "$script_dir/PKGBUILD.bin" "$output_dir/PKGBUILD"
sed -i \
  -e "s/^pkgver=.*/pkgver=${release_version}/" \
  -e "s/^sha256sums_x86_64=.*/sha256sums_x86_64=('${x86_checksum}')/" \
  -e "s/^sha256sums_aarch64=.*/sha256sums_aarch64=('${arm_checksum}')/" \
  "$output_dir/PKGBUILD"

gh release download "$release_version" \
  --repo timmo001/home-assistant-tui \
  --pattern "$x86_archive" \
  --dir "$output_dir"
tar -xzf "$output_dir/$x86_archive" -C "$output_dir"
"$output_dir/home-assistant-tui" completions bash \
  > "$output_dir/home-assistant-tui.bash"
"$output_dir/home-assistant-tui" completions fish \
  > "$output_dir/home-assistant-tui.fish"
"$output_dir/home-assistant-tui" completions zsh \
  > "$output_dir/_home-assistant-tui"
install -m 0644 "$repo_root/LICENSE" "$output_dir/LICENSE"
rm -f "$output_dir/home-assistant-tui" \
  "$output_dir/$x86_archive" \
  "$output_dir/SHA256SUMS"

echo "Prepared home-assistant-tui-bin ${release_version} in ${output_dir}"
