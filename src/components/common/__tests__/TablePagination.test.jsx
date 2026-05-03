import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TablePagination from '@/components/common/TablePagination';

function renderPagination(overrides = {}) {
    const onPageChange = vi.fn();
    const props = {
        currentPage: 1,
        totalItems: 100,
        itemsPerPage: 25,
        onPageChange,
        ...overrides,
    };
    const utils = render(<TablePagination {...props} />);
    return { ...utils, onPageChange, props };
}

describe('TablePagination', () => {
    it('renders the range summary for the first page', () => {
        renderPagination({ currentPage: 1, totalItems: 100, itemsPerPage: 25 });
        const nav = screen.getByRole('navigation', { name: /pagination/i });
        expect(nav.textContent).toMatch(/Showing/);
        expect(nav.textContent).toMatch(/1/);
        expect(nav.textContent).toMatch(/25/);
        expect(nav.textContent).toMatch(/100/);
    });

    it('renders the range summary mid-range', () => {
        renderPagination({ currentPage: 3, totalItems: 100, itemsPerPage: 25 });
        const nav = screen.getByRole('navigation', { name: /pagination/i });
        expect(nav.textContent).toMatch(/51/);
        expect(nav.textContent).toMatch(/75/);
    });

    it('clamps the last-page range to totalItems', () => {
        renderPagination({ currentPage: 4, totalItems: 87, itemsPerPage: 25 });
        const nav = screen.getByRole('navigation', { name: /pagination/i });
        expect(nav.textContent).toMatch(/76/);
        expect(nav.textContent).toMatch(/87/);
    });

    it('disables Previous on the first page', () => {
        renderPagination({ currentPage: 1 });
        expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /next page/i })).not.toBeDisabled();
    });

    it('disables Next on the last page', () => {
        renderPagination({ currentPage: 4, totalItems: 100, itemsPerPage: 25 });
        expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /previous page/i })).not.toBeDisabled();
    });

    it('calls onPageChange with next page', () => {
        const { onPageChange } = renderPagination({ currentPage: 2 });
        fireEvent.click(screen.getByRole('button', { name: /next page/i }));
        expect(onPageChange).toHaveBeenCalledWith(3);
    });

    it('calls onPageChange with previous page', () => {
        const { onPageChange } = renderPagination({ currentPage: 2 });
        fireEvent.click(screen.getByRole('button', { name: /previous page/i }));
        expect(onPageChange).toHaveBeenCalledWith(1);
    });

    it('renders a helpful empty message when totalItems is 0', () => {
        renderPagination({ currentPage: 1, totalItems: 0 });
        const nav = screen.getByRole('navigation', { name: /pagination/i });
        expect(nav.textContent).toMatch(/No items/);
    });

    it('uses the itemLabel prop for pluralization', () => {
        renderPagination({ totalItems: 7, itemsPerPage: 10, itemLabel: 'agent' });
        const nav = screen.getByRole('navigation', { name: /pagination/i });
        expect(nav.textContent).toMatch(/agents/);
    });
});
