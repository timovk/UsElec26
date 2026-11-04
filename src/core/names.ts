/** Personal-name helpers for display and commentary. */
const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;

/** The surname of a full name, skipping generational suffixes ("Paul Rodriguez Jr." → "Rodriguez"). */
export function surname(full: string): string {
  const parts = full.trim().split(/\s+/);
  while (parts.length > 1 && SUFFIX.test(parts[parts.length - 1]!.replace(/,$/, ''))) parts.pop();
  return (parts[parts.length - 1] ?? full).replace(/,$/, '');
}
