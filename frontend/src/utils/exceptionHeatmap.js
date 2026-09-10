import { scheduledFor, statusOf } from './rosterUtils';

/** "Store Prep &\nMorning" -> "Store Prep & Morning" for headings and pop-ups. */
export const blockName = (block) => String(block?.label ?? '').replace(/\s*\n\s*/g, ' ');

const byGapDesc = (a, b) => b.gap - a.gap;

/**
 * Aggregates every store the signed-in user may see into one demand block grid.
 * Each cell knows exactly which stores are short-staffed or over-staffed, so
 * the heatmap can hand that list straight to the pop-up.
 *
 * storeRosters: [{ store, staff }] — already scoped by the service layer.
 */
export const buildExceptionRows = (storeRosters = [], days = [], blocks = []) =>
  blocks.map((block) => ({
    id: block.id,
    label: block.label,
    caption: block.caption,
    name: blockName(block),
    from: block.from,
    to: block.to,
    cells: days.map((day) => {
      const demand = block.demand?.[day] ?? 0;
      const understaffed = [];
      const overstaffed = [];
      const matched = [];

      storeRosters.forEach(({ store, staff }) => {
        const scheduled = scheduledFor(staff, day, block);
        const status = statusOf(demand, scheduled);
        const entry = { store, demand, scheduled, gap: Math.abs(demand - scheduled), status };
        if (status === 'understaffed') understaffed.push(entry);
        else if (status === 'overstaffed') overstaffed.push(entry);
        else matched.push(entry);
      });

      return {
        day,
        demand,
        understaffed: understaffed.sort(byGapDesc),
        overstaffed: overstaffed.sort(byGapDesc),
        matched,
        storeCount: storeRosters.length
      };
    })
  }));

export const hasException = (cell) =>
  Boolean(cell) && (cell.understaffed.length > 0 || cell.overstaffed.length > 0);

/** Stores in the cell for one status, used by the pop-up list. */
export const storesInCell = (cell, status) =>
  status === 'overstaffed' ? cell?.overstaffed ?? [] : cell?.understaffed ?? [];

/**
 * Rolls the same rows up per store — the Area Coach anomaly list needs
 * "which store, how many exception blocks" rather than "which block".
 */
export const summariseByStore = (rows = []) => {
  const summary = new Map();

  const bump = (entry, key, cell, row) => {
    const current =
      summary.get(entry.store.id) ??
      { store: entry.store, understaffed: 0, overstaffed: 0, worstGap: 0, worst: null };
    current[key] += 1;
    if (entry.gap > current.worstGap) {
      current.worstGap = entry.gap;
      current.worst = { day: cell.day, block: row.name, status: entry.status, gap: entry.gap };
    }
    summary.set(entry.store.id, current);
  };

  rows.forEach((row) =>
    row.cells.forEach((cell) => {
      cell.understaffed.forEach((entry) => bump(entry, 'understaffed', cell, row));
      cell.overstaffed.forEach((entry) => bump(entry, 'overstaffed', cell, row));
    })
  );

  return [...summary.values()].sort(
    (a, b) => b.understaffed - a.understaffed || b.worstGap - a.worstGap
  );
};
