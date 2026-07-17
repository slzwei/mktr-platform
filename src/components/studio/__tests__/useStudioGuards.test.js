import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useStudioGuards from '../useStudioGuards';

describe('useStudioGuards', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('guardedRun executes immediately when clean, parks behind the modal when dirty', () => {
    const { result, rerender } = renderHook(({ dirty }) => useStudioGuards({ dirty }), {
      initialProps: { dirty: false },
    });
    const action = vi.fn();
    act(() => result.current.guardedRun('copy', action));
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.guard).toBe(null);

    rerender({ dirty: true });
    act(() => result.current.guardedRun('copy', action));
    expect(action).toHaveBeenCalledTimes(1); // not run again
    expect(result.current.guard).toEqual({ kind: 'copy', action });
  });

  it('pushes ONE history sentinel when dirty flips true (no stacking across cycles)', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const { rerender } = renderHook(({ dirty }) => useStudioGuards({ dirty }), {
      initialProps: { dirty: false },
    });
    expect(pushSpy).not.toHaveBeenCalled();
    rerender({ dirty: true });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy.mock.calls[0][0]).toEqual({ __studioGuard: true });
    // dirty → clean → dirty again: still just the one sentinel
    rerender({ dirty: false });
    rerender({ dirty: true });
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('browser Back while dirty re-pushes the sentinel and raises the guard modal (F10)', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const { result } = renderHook(() => useStudioGuards({ dirty: true }));
    expect(pushSpy).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.guard).toEqual({ kind: 'back-browser' });
    expect(pushSpy).toHaveBeenCalledTimes(2); // re-pushed
  });

  it('popstate while clean does nothing', () => {
    const { result, rerender } = renderHook(({ dirty }) => useStudioGuards({ dirty }), {
      initialProps: { dirty: true },
    });
    rerender({ dirty: false });
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.guard).toBe(null);
  });

  it('leaveViaHistory skips the re-pushed sentinel with go(-2) and bypasses the guard ONCE (Codex diff #2)', () => {
    const goSpy = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    const { result } = renderHook(() => useStudioGuards({ dirty: true }));
    act(() => result.current.leaveViaHistory());
    expect(goSpy).toHaveBeenCalledWith(-2);
    // The bypass flag suppresses the guard on the resulting popstate…
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.guard).toBe(null);
    // …and is CONSUMED: a later Back while still dirty is guarded again.
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.guard).toEqual({ kind: 'back-browser' });
  });

  it('re-arms the sentinel per campaign (a switch under the same route earns the new campaign its own entry)', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const { rerender } = renderHook(({ dirty, campaignId }) => useStudioGuards({ dirty, campaignId }), {
      initialProps: { dirty: true, campaignId: 'A' },
    });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    // Clean save on A, then switch to B and dirty it: B pushes its OWN sentinel.
    rerender({ dirty: false, campaignId: 'A' });
    rerender({ dirty: false, campaignId: 'B' });
    rerender({ dirty: true, campaignId: 'B' });
    expect(pushSpy).toHaveBeenCalledTimes(2);
  });
});
