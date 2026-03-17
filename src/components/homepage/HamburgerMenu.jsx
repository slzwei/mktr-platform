// Hamburger Menu Component
const HamburgerMenu = ({ isOpen, toggle }) =>
<button
  className={`hamburger hamburger--spring ${isOpen ? 'is-active' : ''}`}
  type="button"
  onClick={toggle}
  aria-label="Menu">

    <span className="hamburger-box">
      <span className="hamburger-inner"></span>
    </span>
  </button>;

export default HamburgerMenu;
