/**
 * Canvas click-to-edit targets (Studio) — the single source of truth mapping a
 * `data-se` doc path (stamped on text-bearing elements in templates.jsx /
 * drawTemplates.jsx / BrandFooter) to the inspector field that edits it.
 *
 * Contract, enforced by tests:
 *  - every `data-se` value the templates render is a key here
 *    (campaignPage editTargets sweep);
 *  - every `id` here exists in the rendered panel of its `section`
 *    (studio editTargets panel test).
 *
 * `focus: false` marks anchor-only targets (no single input to focus — e.g.
 * the hero-media control group): the Studio scrolls + flashes instead.
 */
import { useCallback, useEffect, useRef } from 'react';

export const STUDIO_EDIT_TARGETS = {
  'content.wordmark': { section: 'page', id: 'studio-wordmark' },
  'content.headline': { section: 'page', id: 'studio-headline' },
  'content.subheadline': { section: 'page', id: 'studio-subheadline' },
  'content.story': { section: 'page', id: 'studio-story' },
  'content.emphasis': { section: 'page', id: 'studio-emphasis' },
  'content.media': { section: 'page', id: 'studio-media-kind', focus: false },
  'content.footer.regulatory': { section: 'page', id: 'studio-regulatory' },
  'content.footer.brand': { section: 'page', id: 'studio-brand-footer' },
  'template.params.express.trustLine': { section: 'page', id: 'studio-trustline' },
};

/** Scroll + focus (caret at end) + flash one inspector field, by target. */
export function applyEditTargetFocus(target, doc = document) {
  const el = doc.getElementById(target.id);
  if (!el) return false;
  el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  if (target.focus !== false) {
    el.focus?.({ preventScroll: true });
    const len = typeof el.value === 'string' ? el.value.length : null;
    if (len !== null && typeof el.setSelectionRange === 'function') el.setSelectionRange(len, len);
  }
  // Web Animations API — auto-cleans, absent in jsdom, hence the guard.
  el.animate?.(
    [
      { outline: '2px solid rgba(64,89,200,.9)', outlineOffset: '2px' },
      { outline: '2px solid rgba(64,89,200,0)', outlineOffset: '2px' },
    ],
    { duration: 1100, easing: 'ease-out' }
  );
  return true;
}

/**
 * The canvas → inspector jump: switch the rail to the target's section, then
 * (after the panel has committed — two frames) scroll/focus/flash its field.
 * Deferred work is TOKEN-CANCELLED: a newer jump or unmount invalidates any
 * pending choreography, so a stale callback can never steal focus later.
 */
export function useEditTargetFocus(setSection) {
  const seqRef = useRef(0);
  useEffect(() => () => { seqRef.current += 1; }, []); // unmount cancels pending work
  return useCallback(
    (path) => {
      if (!Object.prototype.hasOwnProperty.call(STUDIO_EDIT_TARGETS, path)) return;
      const target = STUDIO_EDIT_TARGETS[path];
      setSection(target.section);
      const my = ++seqRef.current;
      const raf =
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame
          : (fn) => setTimeout(fn, 16);
      raf(() => {
        raf(() => {
          if (seqRef.current !== my) return;
          applyEditTargetFocus(target);
        });
      });
    },
    [setSection]
  );
}
