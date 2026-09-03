import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import SortableList, { reorderIds } from '../SortableList';

const ITEMS = [
  { id: 'a', label: 'Hero', meta: 'Launch' },
  { id: 'b', label: 'Text', meta: 'Body' },
  { id: 'f', label: 'RSVP form', locked: true, lockedReason: 'Always present' },
];

describe('SortableList', () => {
  it('reorderIds moves the active id to the over slot', () => {
    expect(reorderIds(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
    expect(reorderIds(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(reorderIds(['a', 'b', 'c'], 'b', 'b')).toEqual(['a', 'b', 'c']);
    expect(reorderIds(['a', 'b'], 'zz', 'a')).toEqual(['a', 'b']);
  });

  it('renders keyboard-reachable drag handles, select + delete, and hides delete on locked rows', async () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    render(<SortableList items={ITEMS} selectedId="a" onSelect={onSelect} onDelete={onDelete} onReorder={vi.fn()} ariaLabel="Blocks" />);
    expect(screen.getByRole('list', { name: 'Blocks' })).toBeInTheDocument();
    const handle = screen.getByRole('button', { name: 'Drag Hero' });
    expect(handle).toHaveAttribute('aria-roledescription', 'sortable');
    expect(screen.getByRole('button', { name: 'Delete Text' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete RSVP form' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('RSVP form cannot be removed')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Text/ , pressed: false }));
    expect(onSelect).toHaveBeenCalledWith('b');
    await userEvent.click(screen.getByRole('button', { name: 'Delete Text' }));
    expect(onDelete).toHaveBeenCalledWith('b');
  });
});
