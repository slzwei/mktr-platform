import { useCallback, useRef, useState } from 'react';

/**
 * Map-based row selection for paginated admin tables.
 *
 * Selection is a Map<id, rowSnapshot> — snapshots (not bare ids) so cross-page
 * selections keep working for exports and eligibility previews after the page
 * of origin has unmounted. Selection survives page turns; the OWNING page must
 * call `clear()` synchronously in its filter/search handlers (an effect watching
 * query params would let keepPreviousData's stale rows be selected under a new
 * filter, and would also wipe selection on every page turn).
 *
 * `toggleRow(row, { shiftKey })` supports shift-click range selection anchored
 * on the last explicitly toggled row of the CURRENT page (`rows`).
 */
export default function useRowSelection(rows = []) {
  const [selected, setSelected] = useState(() => new Map());
  const anchorIdRef = useRef(null);

  const isSelected = useCallback((id) => selected.has(id), [selected]);

  const clear = useCallback(() => {
    anchorIdRef.current = null;
    setSelected((prev) => (prev.size === 0 ? prev : new Map()));
  }, []);

  const toggleRow = useCallback(
    (row, { shiftKey = false } = {}) => {
      if (!row?.id) return;
      setSelected((prev) => {
        const next = new Map(prev);
        const anchorIdx = shiftKey && anchorIdRef.current ? rows.findIndex((r) => r.id === anchorIdRef.current) : -1;
        const clickIdx = rows.findIndex((r) => r.id === row.id);

        if (anchorIdx !== -1 && clickIdx !== -1) {
          // Shift-range: select everything between the anchor and the clicked row
          // (inclusive). Always ADDS — a ranged deselect is more surprising than
          // useful, and a plain click still toggles one row off.
          const [from, to] = anchorIdx < clickIdx ? [anchorIdx, clickIdx] : [clickIdx, anchorIdx];
          for (let i = from; i <= to; i++) next.set(rows[i].id, rows[i]);
        } else if (next.has(row.id)) {
          next.delete(row.id);
        } else {
          next.set(row.id, row);
        }
        anchorIdRef.current = row.id;
        return next;
      });
    },
    [rows]
  );

  // Header checkbox: page-additive select-all / page-subtractive deselect-all —
  // never touches rows selected on OTHER pages.
  const allVisibleSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someVisibleSelected = !allVisibleSelected && rows.some((r) => selected.has(r.id));

  const toggleAllVisible = useCallback(() => {
    setSelected((prev) => {
      const next = new Map(prev);
      const everyVisible = rows.length > 0 && rows.every((r) => next.has(r.id));
      if (everyVisible) for (const r of rows) next.delete(r.id);
      else for (const r of rows) next.set(r.id, r);
      return next;
    });
    anchorIdRef.current = null;
  }, [rows]);

  return {
    selected,
    selectedRows: [...selected.values()],
    selectedIds: [...selected.keys()],
    count: selected.size,
    isSelected,
    toggleRow,
    toggleAllVisible,
    allVisibleSelected,
    someVisibleSelected,
    clear,
  };
}
