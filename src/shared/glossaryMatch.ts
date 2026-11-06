/**
 * The entries (keyed "<lang>:<lower-case term>") whose term appears in a text as a whole
 * word: "cell" must not match "cellular". No dependency, so it can be tried on its own.
 */
export function findKnown<T>(text: string, prefix: string, entries: Iterable<[string, T]>): T[] {
  const hay = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  const found: T[] = [];
  for (const [key, entry] of entries) {
    if (!key.startsWith(prefix)) continue;
    const needle = key.slice(prefix.length);
    // Every occurrence is looked at: "cell" may come first inside "cellular", then alone.
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
      const before = hay[i - 1];
      const after = hay[i + needle.length];
      if (/[\p{L}\p{N}]/u.test(before ?? "") || /[\p{L}\p{N}]/u.test(after ?? "")) continue;
      found.push(entry);
      break;
    }
  }
  return found;
}

/**
 * A name that cannot be mistaken for an ordinary word: one word with a digit or capitals
 * inside (CD127, STED-FLIM, TIGIT, VGG16-UNet). An ordinary word ("topic") may have another
 * meaning elsewhere, so it is never forced; these names are.
 */
export function isDistinctiveName(term: string): boolean {
  return /^\S+$/.test(term) && (/[0-9]/.test(term) || (term.match(/\p{Lu}/gu) ?? []).length >= 2);
}
