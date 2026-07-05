import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import useRowSelection from '../useRowSelection';

const rows = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
  { id: 'c', name: 'C' },
  { id: 'd', name: 'D' },
];

describe('useRowSelection', () => {
  it('toggles single rows and exposes snapshots', () => {
    const { result } = renderHook(() => useRowSelection(rows));
    act(() => result.current.toggleRow(rows[1]));
    expect(result.current.count).toBe(1);
    expect(result.current.isSelected('b')).toBe(true);
    expect(result.current.selectedRows).toEqual([rows[1]]);
    act(() => result.current.toggleRow(rows[1]));
    expect(result.current.count).toBe(0);
  });

  it('shift-click selects the inclusive range from the anchor', () => {
    const { result } = renderHook(() => useRowSelection(rows));
    act(() => result.current.toggleRow(rows[0]));
    act(() => result.current.toggleRow(rows[2], { shiftKey: true }));
    expect(result.current.selectedIds.sort()).toEqual(['a', 'b', 'c']);
    // Reverse direction works too.
    act(() => result.current.toggleRow(rows[3]));
    act(() => result.current.toggleRow(rows[1], { shiftKey: true }));
    expect(result.current.selectedIds.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('select-all is page-additive and deselect-all page-subtractive (other pages untouched)', () => {
    const page1 = rows.slice(0, 2);
    const page2 = rows.slice(2);
    const { result, rerender } = renderHook(({ r }) => useRowSelection(r), { initialProps: { r: page1 } });

    act(() => result.current.toggleAllVisible());
    expect(result.current.selectedIds.sort()).toEqual(['a', 'b']);

    // Page turn: selection survives; select-all on page 2 ADDS.
    rerender({ r: page2 });
    expect(result.current.count).toBe(2);
    expect(result.current.allVisibleSelected).toBe(false);
    act(() => result.current.toggleAllVisible());
    expect(result.current.selectedIds.sort()).toEqual(['a', 'b', 'c', 'd']);

    // Deselect-all on page 2 removes only page 2 rows.
    act(() => result.current.toggleAllVisible());
    expect(result.current.selectedIds.sort()).toEqual(['a', 'b']);
  });

  it('header state distinguishes all / some / none of the visible rows', () => {
    const { result } = renderHook(() => useRowSelection(rows));
    expect(result.current.allVisibleSelected).toBe(false);
    expect(result.current.someVisibleSelected).toBe(false);
    act(() => result.current.toggleRow(rows[0]));
    expect(result.current.someVisibleSelected).toBe(true);
    act(() => result.current.toggleAllVisible());
    expect(result.current.allVisibleSelected).toBe(true);
    expect(result.current.someVisibleSelected).toBe(false);
  });

  it('clear empties the selection and drops the shift anchor', () => {
    const { result } = renderHook(() => useRowSelection(rows));
    act(() => result.current.toggleRow(rows[0]));
    act(() => result.current.clear());
    expect(result.current.count).toBe(0);
    // No anchor → shift-click behaves like a plain toggle.
    act(() => result.current.toggleRow(rows[2], { shiftKey: true }));
    expect(result.current.selectedIds).toEqual(['c']);
  });
});
