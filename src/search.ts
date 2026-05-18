import Fuse, { type FuseOptionKey, type Expression } from "fuse.js";

/**
 * Strip diacritics from a string for accent-insensitive comparison.
 * Uses NFD decomposition to separate base characters from combining marks,
 * then removes the combining diacritical marks range.
 */
function stripDiacritics(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Two-phase search algorithm matching the Home Assistant frontend's
 * `/config/entities` page behaviour:
 *
 * 1. **Exact substring match** — splits query into space-separated terms,
 *    strips diacritics, lowercases, then checks if ALL terms appear as
 *    substrings in any of the item's searchable fields.
 *
 * 2. **Fuse.js fuzzy fallback** — only when exact matching returns zero
 *    results. Uses stricter settings than the main menu filter (threshold
 *    0.2 vs 0.4, minMatchCharLength 2, ignoreLocation).
 *
 * @param items       Full item list to search
 * @param query       Raw search query string
 * @param getFields   Extracts searchable string fields from an item
 * @param fuseKeys    Fuse.js key definitions for the fuzzy fallback
 * @returns Filtered items preserving original order (exact) or relevance order (fuzzy)
 */
export function twoPhaseSearch<T>(
  items: readonly T[],
  query: string,
  getFields: (item: T) => readonly string[],
  fuseKeys: ReadonlyArray<FuseOptionKey<T>>,
): readonly T[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return items;

  const terms = stripDiacritics(trimmed).toLowerCase().split(/\s+/);

  // Phase 1: exact substring match (all terms must appear somewhere)
  const exactResults = filterExact(items, terms, getFields, fuseKeys);
  if (exactResults.length > 0) return exactResults;

  // Phase 2: fuzzy fallback
  return filterFuzzy(items, terms, fuseKeys);
}

/**
 * Phase 1: exact substring matching.
 * All terms must appear as substrings within the combined searchable
 * fields of an item. Results are then ranked by Fuse.js so that
 * exact name matches and prefix matches score highest.
 */
function filterExact<T>(
  items: readonly T[],
  terms: readonly string[],
  getFields: (item: T) => readonly string[],
  fuseKeys: ReadonlyArray<FuseOptionKey<T>>,
): readonly T[] {
  // Collect items that pass exact substring matching
  const matched: T[] = [];

  for (const item of items) {
    const fields = getFields(item);
    let passes: boolean;

    if (terms.length === 1) {
      passes = fields.some((field) =>
        stripDiacritics(field).toLowerCase().includes(terms[0]),
      );
    } else {
      const searchString = fields
        .map((f) => stripDiacritics(f).toLowerCase())
        .join(" ");
      passes = terms.every((term) => searchString.includes(term));
    }

    if (passes) matched.push(item);
  }

  if (matched.length === 0) return [];

  // Use Fuse.js to rank the matched items — location: 0 + low distance
  // means matches at the start of the string score much higher
  const fuse = new Fuse(matched, {
    keys: fuseKeys as FuseOptionKey<T>[],
    threshold: 1.0, // accept all (already filtered)
    ignoreLocation: false,
    location: 0,
    distance: 50,
    minMatchCharLength: 1,
    isCaseSensitive: false,
    shouldSort: true,
  });

  const query = terms.join(" ");
  return fuse.search(query).map((r) => r.item);
}

/**
 * Phase 2: Fuse.js fuzzy search fallback.
 * Only invoked when exact matching yields zero results.
 */
function filterFuzzy<T>(
  items: readonly T[],
  terms: readonly string[],
  fuseKeys: ReadonlyArray<FuseOptionKey<T>>,
): readonly T[] {
  const fuse = new Fuse([...items], {
    keys: fuseKeys as FuseOptionKey<T>[],
    threshold: 0.2,
    ignoreLocation: true,
    minMatchCharLength: 2,
    isCaseSensitive: false,
    shouldSort: true,
  });

  if (terms.length === 1) {
    return fuse.search(terms[0]).map((r) => r.item);
  }

  // Multi-term: Fuse.js $and expression (all terms must match)
  const expression: Expression = {
    $and: terms.map((term) => ({
      $or: (fuseKeys as FuseOptionKey<T>[]).map((key) => {
        const name =
          typeof key === "string" ? key : (key as { name: string }).name;
        return { [name]: term } as Expression;
      }),
    })),
  };
  return fuse.search(expression).map((r) => r.item);
}
