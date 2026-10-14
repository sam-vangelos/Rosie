/**
 * Apply a tier-scoped select/deselect operation to a candidate selection set.
 * Returns a new Set — does not mutate the input.
 */
export function applyTierSelection(
  current: Set<string>,
  action: 'select' | 'deselect',
  ids: string[]
): Set<string> {
  const next = new Set(current);
  if (action === 'deselect') {
    ids.forEach((id) => next.delete(id));
  } else {
    ids.forEach((id) => next.add(id));
  }
  return next;
}
