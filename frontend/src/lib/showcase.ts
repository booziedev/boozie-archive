import type { SlotCount } from './types';

/**
 * How many picks a showcase list may show.
 *
 * Three reads as a statement, ten as a chart, and five sits between them. The
 * same three values are enforced by a CHECK constraint on the server, so this
 * is the list to render rather than the rule.
 */
export const SLOT_CHOICES: SlotCount[] = [3, 5, 10];
