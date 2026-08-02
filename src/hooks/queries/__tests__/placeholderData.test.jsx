/**
 * P2-16 regression: paginated lists hold their rows across a param change.
 *
 * `keepPreviousData: true` is the React-Query **v4** flag. v5 removed it and
 * ignores it SILENTLY — no warning, no type error, nothing at runtime. So
 * useAgentsRoster, useWalletLedger and the QR-codes list flashed empty on every
 * page / agent / filter switch while the next request was in flight, and the
 * file four lines above them already documented the correct v5 idiom.
 *
 * The behavioural half is asserted through a real QueryClient; the source scan
 * guards the property that decays — that the dead flag does not creep back.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery, keepPreviousData } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';

import useAdminV2Source from '../useAdminV2.js?raw';
import qrCodesSource from '../../../pages/adminv2/AdminV2QRCodes.jsx?raw';

const SOURCES = [
  ['useAdminV2', useAdminV2Source],
  ['AdminV2QRCodes', qrCodesSource],
];

/** The literal that v5 ignores — matched only as an OPTION, not in prose. */
const DEAD_FLAG = /^\s*keepPreviousData:\s*true\s*,?\s*$/m;

describe('no v4 keepPreviousData flag survives', () => {
  for (const [name, src] of SOURCES) {
    it(`${name} passes no bare keepPreviousData: true`, () => {
      expect(src).not.toMatch(DEAD_FLAG);
    });

    it(`${name} imports the v5 keepPreviousData sentinel it uses`, () => {
      if (!src.includes('placeholderData: keepPreviousData')) return;
      expect(src).toMatch(/import \{[^}]*keepPreviousData[^}]*\} from ['"]@tanstack\/react-query['"]/);
    });
  }
});

describe('placeholderData: keepPreviousData holds prior rows', () => {
  const wrapper = (client) => function Wrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

  it('keeps the previous page visible while the next one loads', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetchPage = vi.fn(async (page) => ({ rows: [`row-${page}`] }));

    const { result, rerender } = renderHook(
      ({ page }) => useQuery({
        queryKey: ['roster', page],
        queryFn: () => fetchPage(page),
        placeholderData: keepPreviousData,
      }),
      { wrapper: wrapper(client), initialProps: { page: 1 } }
    );

    await waitFor(() => expect(result.current.data).toEqual({ rows: ['row-1'] }));

    rerender({ page: 2 });

    // THE property: page 1's rows are still on screen while page 2 is in
    // flight — no empty flash. Without the v5 idiom this is undefined here.
    expect(result.current.data).toEqual({ rows: ['row-1'] });
    expect(result.current.isPlaceholderData).toBe(true);

    await waitFor(() => expect(result.current.data).toEqual({ rows: ['row-2'] }));
    expect(result.current.isPlaceholderData).toBe(false);
  });

  it('the removed v4 flag does NOT hold rows — this is what the hooks were doing', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetchPage = vi.fn(async (page) => ({ rows: [`row-${page}`] }));

    const { result, rerender } = renderHook(
      ({ page }) => useQuery({
        queryKey: ['legacy', page],
        queryFn: () => fetchPage(page),
        keepPreviousData: true, // v4 flag — v5 ignores it silently
      }),
      { wrapper: wrapper(client), initialProps: { page: 1 } }
    );

    await waitFor(() => expect(result.current.data).toEqual({ rows: ['row-1'] }));

    rerender({ page: 2 });

    // The empty flash, demonstrated.
    expect(result.current.data).toBeUndefined();
  });
});
