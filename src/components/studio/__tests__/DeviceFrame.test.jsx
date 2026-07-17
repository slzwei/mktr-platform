import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { Link } from 'react-router-dom';
import DeviceFrame from '../DeviceFrame';
import { usePortalContainer } from '@/lib/portalContainerContext';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

const frameDoc = (container) => container.querySelector('iframe')?.contentDocument;

describe('DeviceFrame — own React root inside a true-viewport iframe', () => {
  it('mounts children INSIDE the iframe document, not the parent DOM', async () => {
    const { container } = render(
      <DeviceFrame width={390}>
        <div data-testid="framed-child">hello</div>
      </DeviceFrame>
    );
    await waitFor(() => {
      expect(frameDoc(container)?.querySelector('[data-testid="framed-child"]')).toBeTruthy();
    });
    expect(document.querySelector('[data-testid="framed-child"]')).toBeNull();
  });

  it('sizes the iframe to the exact device viewport and scales via transform', () => {
    const { container } = render(
      <DeviceFrame width={390} height={800} scale={0.5}>
        <div />
      </DeviceFrame>
    );
    const iframe = container.querySelector('iframe');
    expect(iframe.style.width).toBe('390px');
    expect(iframe.style.height).toBe('800px');
    expect(iframe.style.transform).toBe('scale(0.5)');
  });

  it('copies parent stylesheets into the frame head and syncs late-injected ones (Vite dev/HMR)', async () => {
    const preexisting = document.createElement('style');
    preexisting.textContent = '.pre-existing-style { color: red; }';
    document.head.appendChild(preexisting);
    try {
      const { container } = render(
        <DeviceFrame width={390}>
          <div />
        </DeviceFrame>
      );
      await waitFor(() => {
        const styles = [...(frameDoc(container)?.head.querySelectorAll('style') || [])];
        expect(styles.some((s) => s.textContent.includes('.pre-existing-style'))).toBe(true);
      });

      const late = document.createElement('style');
      late.textContent = '.late-injected-style { color: blue; }';
      act(() => {
        document.head.appendChild(late);
      });
      try {
        await waitFor(() => {
          const styles = [...(frameDoc(container)?.head.querySelectorAll('style') || [])];
          expect(styles.some((s) => s.textContent.includes('.late-injected-style'))).toBe(true);
        });

        // Vite HMR MUTATES existing style text in place (Codex diff #10) —
        // the tracked clone must follow.
        act(() => {
          late.textContent = '.late-injected-style { color: green; }';
        });
        await waitFor(() => {
          const styles = [...(frameDoc(container)?.head.querySelectorAll('style') || [])];
          expect(styles.some((s) => s.textContent.includes('color: green'))).toBe(true);
        });

        // And a REMOVED source drops its clone from the frame.
        act(() => {
          late.remove();
        });
        await waitFor(() => {
          const styles = [...(frameDoc(container)?.head.querySelectorAll('style') || [])];
          expect(styles.some((s) => s.textContent.includes('.late-injected-style'))).toBe(false);
        });
      } finally {
        late.remove();
      }
    } finally {
      preexisting.remove();
    }
  });

  it('provides an in-frame portal container so Radix dialogs stay contained (F4)', async () => {
    const { container } = render(
      <DeviceFrame width={390}>
        <Dialog open>
          <DialogContent>
            <DialogTitle>Contained dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </DeviceFrame>
    );
    await waitFor(() => {
      expect(frameDoc(container)?.body.textContent).toContain('Contained dialog');
    });
    // The parent document must NOT receive the portal.
    expect(document.body.textContent).not.toContain('Contained dialog');
  });

  it('wraps a MemoryRouter so router-dependent previews render (extracted ErrorState Link)', async () => {
    const { container } = render(
      <DeviceFrame width={390}>
        <Link to="/Dashboard">Back to Safe Zone</Link>
      </DeviceFrame>
    );
    await waitFor(() => {
      expect(frameDoc(container)?.querySelector('a[href="/Dashboard"]')).toBeTruthy();
    });
  });

  it('exposes the portal container to consumers via context', async () => {
    function Probe() {
      const node = usePortalContainer();
      return <div data-frame-portal={node ? 'set' : 'missing'} />;
    }
    const { container } = render(
      <DeviceFrame width={390}>
        <Probe />
      </DeviceFrame>
    );
    await waitFor(() => {
      expect(frameDoc(container)?.querySelector('[data-frame-portal="set"]')).toBeTruthy();
    });
  });

  it('tears down cleanly (observer disconnected, deferred root unmount, no parent leakage)', async () => {
    vi.useFakeTimers();
    try {
      const { container, unmount } = render(
        <DeviceFrame width={390}>
          <div data-testid="framed-child" />
        </DeviceFrame>
      );
      await vi.waitFor(() => {
        expect(frameDoc(container)?.querySelector('[data-testid="framed-child"]')).toBeTruthy();
      });
      unmount();
      act(() => {
        vi.runAllTimers(); // flushes the deferred root.unmount()
      });
      expect(document.querySelector('[data-testid="framed-child"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
