/**
 * Chart hover layer — snap-to-day crosshair + tooltip on the two time-series
 * plots. jsdom has no layout, so pointer tests stub getBoundingClientRect;
 * keyboard tests need no geometry at all.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SeriesLineChart, SeriesBarChart } from '../charts';

const DAYS = [
  { date: '2026-07-14', count: 3 },
  { date: '2026-07-15', count: 0 },
  { date: '2026-07-16', count: 1 },
  { date: '2026-07-17', count: 12 },
];

function stubRect(el, width = 400) {
  el.getBoundingClientRect = () => ({ left: 0, right: width, top: 0, bottom: 118, width, height: 118, x: 0, y: 0 });
}

describe('SeriesLineChart', () => {
  const chart = () => screen.getByRole('group');
  const tip = () => screen.getByRole('status', { hidden: true });

  it('hides the tooltip until the chart is hovered or focused', () => {
    render(<SeriesLineChart days={DAYS} max={12} avgPerDay={4} />);
    expect(tip()).not.toBeVisible();
  });

  it('focus lands on today; arrows walk days; Escape dismisses', () => {
    render(<SeriesLineChart days={DAYS} max={12} avgPerDay={4} />);
    fireEvent.focus(chart());
    expect(tip()).toBeVisible();
    expect(tip()).toHaveTextContent('Fri 17 Jul · today');
    expect(tip()).toHaveTextContent('12 leads');

    fireEvent.keyDown(chart(), { key: 'ArrowLeft' });
    expect(tip()).toHaveTextContent('Thu 16 Jul');
    expect(tip()).toHaveTextContent('1 lead');
    expect(tip()).not.toHaveTextContent('1 leads');

    fireEvent.keyDown(chart(), { key: 'Home' });
    expect(tip()).toHaveTextContent('Tue 14 Jul');
    fireEvent.keyDown(chart(), { key: 'ArrowLeft' }); // clamped at the first day
    expect(tip()).toHaveTextContent('Tue 14 Jul');
    fireEvent.keyDown(chart(), { key: 'End' });
    expect(tip()).toHaveTextContent('Fri 17 Jul');

    fireEvent.keyDown(chart(), { key: 'Escape' });
    expect(tip()).not.toBeVisible();
  });

  it('snaps the pointer to the nearest day vertex', () => {
    render(<SeriesLineChart days={DAYS} max={12} avgPerDay={4} />);
    stubRect(chart());
    // 4 points across 400px sit at x = 0 / 133 / 267 / 400.
    fireEvent.pointerMove(chart(), { clientX: 10 });
    expect(tip()).toHaveTextContent('Tue 14 Jul');
    fireEvent.pointerMove(chart(), { clientX: 150 });
    expect(tip()).toHaveTextContent('Wed 15 Jul');
    fireEvent.pointerMove(chart(), { clientX: 399 });
    expect(tip()).toHaveTextContent('Fri 17 Jul');
    fireEvent.pointerLeave(chart());
    expect(tip()).not.toBeVisible();
  });
});

describe('SeriesBarChart', () => {
  const chart = () => screen.getByRole('group');
  const tip = () => screen.getByRole('status', { hidden: true });
  const BAR_DAYS = DAYS.map((d, i) => ({ ...d, isToday: i === DAYS.length - 1 }));

  it('snaps the pointer to the column under it', () => {
    render(<SeriesBarChart days={BAR_DAYS} />);
    stubRect(chart());
    // 4 columns across 400px: [0,100) [100,200) [200,300) [300,400).
    fireEvent.pointerMove(chart(), { clientX: 150 });
    expect(tip()).toBeVisible();
    expect(tip()).toHaveTextContent('Wed 15 Jul');
    expect(tip()).toHaveTextContent('0 leads');
    fireEvent.pointerMove(chart(), { clientX: 350 });
    expect(tip()).toHaveTextContent('Fri 17 Jul · today');
    expect(tip()).toHaveTextContent('12 leads');
  });

  it('supports keyboard reading like the line chart', () => {
    render(<SeriesBarChart days={BAR_DAYS} />);
    fireEvent.focus(chart());
    expect(tip()).toHaveTextContent('Fri 17 Jul · today');
    fireEvent.keyDown(chart(), { key: 'ArrowLeft' });
    expect(tip()).toHaveTextContent('Thu 16 Jul');
    fireEvent.blur(chart());
    expect(tip()).not.toBeVisible();
  });

  it('renders an empty series without a hover surface', () => {
    render(<SeriesBarChart days={[]} />);
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
