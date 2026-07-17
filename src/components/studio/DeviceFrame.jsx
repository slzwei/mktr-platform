import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { PortalContainerProvider } from '@/lib/portalContainerContext';

/**
 * DeviceFrame — the Studio's TRUE-viewport preview mount (Studio PR 3).
 *
 * The classic designer previews inline (PreviewFrame.jsx documents why an
 * iframe was rejected there: Radix portals escape). The Studio needs real
 * `@media` behavior at 390/1280, so this component establishes the missing
 * precedent deliberately:
 *
 *  - an `about:blank` iframe sized to the EXACT device viewport (CSS-scaled to
 *    fit the canvas), so media queries fire truthfully;
 *  - its own `ReactDOM.createRoot` inside the iframe document (same JS realm,
 *    so React events + contexts work normally);
 *  - parent stylesheets (`<style>` + `<link rel="stylesheet">`, incl. font
 *    links) cloned into the frame head, with a MutationObserver syncing
 *    late-injected ones (Vite dev/HMR injects styles dynamically);
 *  - `PortalContainerProvider` pointing at an in-frame node so Radix dialogs
 *    (consent T&C) stay contained — Radix's default portal target is the
 *    PARENT document.body;
 *  - a `MemoryRouter` because previewed trees contain router hooks (the
 *    extracted ErrorState's <Link>, OfferCard's useNavigate);
 *  - full teardown: observer disconnected, root unmounted (deferred a tick —
 *    React forbids synchronous root unmount during a parent commit).
 */

function copyHeadStyles(parentDoc, frameDoc, tracked) {
  const nodes = parentDoc.head.querySelectorAll('style, link[rel="stylesheet"]');
  nodes.forEach((node) => {
    if (tracked.has(node)) return;
    const clone = node.cloneNode(true);
    frameDoc.head.appendChild(clone);
    tracked.set(node, clone);
  });
}

export default function DeviceFrame({ width, height = 800, scale = 1, ariaLabel = 'Device preview', children }) {
  const iframeRef = useRef(null);
  const rootRef = useRef(null);
  const mountRef = useRef(null);
  const trackedRef = useRef(new Map());
  const observerRef = useRef(null);
  const childrenRef = useRef(children);
  childrenRef.current = children;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return undefined;
    let cancelled = false;

    const renderNow = () => {
      if (!rootRef.current || !mountRef.current) return;
      rootRef.current.render(
        <PortalContainerProvider value={mountRef.current}>
          <MemoryRouter>{childrenRef.current}</MemoryRouter>
        </PortalContainerProvider>
      );
    };

    const init = () => {
      if (cancelled) return;
      const frameDoc = iframe.contentDocument;
      if (!frameDoc) return;
      // Some engines replace the initial about:blank document on load — if our
      // mount no longer belongs to the live document, rebuild from scratch.
      if (mountRef.current && mountRef.current.ownerDocument === frameDoc) return;
      observerRef.current?.disconnect();
      const staleRoot = rootRef.current;
      if (staleRoot) setTimeout(() => staleRoot.unmount(), 0);
      trackedRef.current = new Map();

      frameDoc.body.style.margin = '0';
      const mount = frameDoc.createElement('div');
      mount.setAttribute('data-device-frame-root', 'true');
      frameDoc.body.appendChild(mount);
      mountRef.current = mount;
      copyHeadStyles(document, frameDoc, trackedRef.current);
      const observer = new MutationObserver(() => copyHeadStyles(document, frameDoc, trackedRef.current));
      observer.observe(document.head, { childList: true });
      observerRef.current = observer;
      rootRef.current = createRoot(mount);
      renderNow();
    };

    init();
    iframe.addEventListener('load', init);
    return () => {
      cancelled = true;
      iframe.removeEventListener('load', init);
      observerRef.current?.disconnect();
      observerRef.current = null;
      const root = rootRef.current;
      rootRef.current = null;
      mountRef.current = null;
      trackedRef.current = new Map();
      // Deferred: React 18 forbids unmounting a root synchronously while the
      // parent tree is still committing.
      if (root) setTimeout(() => root.unmount(), 0);
    };
  }, []);

  // Re-render the frame contents whenever the parent re-renders (the unsaved
  // doc flows through `children`). Runs after the init effect on first commit.
  useEffect(() => {
    if (!rootRef.current || !mountRef.current) return;
    rootRef.current.render(
      <PortalContainerProvider value={mountRef.current}>
        <MemoryRouter>{children}</MemoryRouter>
      </PortalContainerProvider>
    );
  });

  return (
    <div style={{ width: width * scale, height: height * scale, position: 'relative', flexShrink: 0 }}>
      <iframe
        ref={iframeRef}
        title={ariaLabel}
        style={{
          width,
          height,
          border: 'none',
          background: '#fff',
          borderRadius: 10,
          boxShadow: '0 18px 50px rgba(0,0,0,.45)',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      />
    </div>
  );
}
