import { it } from 'vitest';

/**
 * A test that describes the correct behaviour for a confirmed defect listed in
 * docs/known-bugs.md. It is expected to fail. When a fix lands, the test passes, Vitest
 * reports that as a failure, and the fix must replace knownBug() with it() in the same
 * change. Ported from the Python project's strict `known_bug` xfail marker.
 */
export function knownBug(id: string, name: string, fn: () => void | Promise<void>): void {
  it.fails(`[known bug ${id}] ${name}`, fn);
}
