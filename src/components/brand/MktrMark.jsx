/**
 * The MKTR brand mark — the square app icon (terracotta chevron on the
 * warm-dark tile), mirroring public/mktr-logo-icon.svg. Fixed palette by
 * design: this is the logo, so it does not follow theme vars. The chevron
 * is a drawn path (no font dependency), so it renders identically at any
 * size on any surface.
 *
 * Decorative by default (aria-hidden) — place it inside a labelled link or
 * pass aria props via rest when it stands alone.
 */
const MktrMark = ({ size = 32, style, ...rest }) => (
  <svg
    viewBox="0 0 64 64"
    width={size}
    height={size}
    style={{ display: 'block', flex: 'none', ...style }}
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <rect width="64" height="64" rx="12" fill="#1B1A17" />
    <path d="M 20 18 L 44 32 L 20 46" fill="none" stroke="#D6552B" strokeWidth="6" strokeLinecap="square" strokeLinejoin="miter" />
  </svg>
);

export default MktrMark;
