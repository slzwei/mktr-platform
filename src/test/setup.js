import '@testing-library/jest-dom';

// jsdom lacks ResizeObserver, which Radix UI primitives (Switch, Slider, …)
// reference on mount. Provide a no-op polyfill so component tests can render them.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
