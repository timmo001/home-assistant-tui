#!/usr/bin/env bun
/**
 * Generates src/data/mdiCodepoints.ts from @mdi/svg/meta.json in the HA frontend.
 *
 * Each MDI icon is assigned a hex codepoint by the MDI project. Nerd Font v3
 * places every MDI icon at the corresponding Unicode private-use code point
 * (U+F{hex}), so String.fromCodePoint(parseInt(codepoint, 16)) gives the
 * correct Nerd Font glyph for any MDI icon name.
 *
 * Usage: bun run scripts/gen-mdi-codepoints.ts
 */

import { join } from "node:path";
import { writeFileSync } from "node:fs";

const META_PATH = join(
  import.meta.dir,
  "../../frontend/node_modules/@mdi/svg/meta.json",
);
const OUT_PATH = join(import.meta.dir, "../src/data/mdiCodepoints.ts");

interface MdiEntry {
  name: string;
  codepoint: string;
}

const meta: MdiEntry[] = JSON.parse(await Bun.file(META_PATH).text());

// Build a compact name→glyph map. The glyph is the Unicode character at the
// MDI-assigned code point, which Nerd Font v3 maps 1:1.
const entries = meta
  .map((e) => {
    const cp = parseInt(e.codepoint, 16);
    const glyph = String.fromCodePoint(cp);
    // Use a JSON-safe escape for the Unicode char so the file is ASCII-clean
    const escaped = `\\u{${e.codepoint}}`;
    return `  "${e.name}": "${escaped}"`;
  })
  .join(",\n");

const source = `// AUTO-GENERATED — do not edit by hand.
// Regenerate with: bun run scripts/gen-mdi-codepoints.ts
// Source: @mdi/svg/meta.json (${meta.length} icons)

/**
 * Maps MDI icon name (e.g. "lightbulb") → Nerd Font v3 Unicode glyph.
 *
 * Nerd Font v3 places every MDI icon at its MDI-assigned code point in
 * Unicode's private-use area (U+F0001…), so String.fromCodePoint of the
 * MDI hex codepoint gives the correct terminal glyph.
 */
export const MDI_CODEPOINTS: Readonly<Record<string, string>> = {
${entries},
};
`;

writeFileSync(OUT_PATH, source, "utf8");
console.log(`Written ${meta.length} entries to ${OUT_PATH}`);
