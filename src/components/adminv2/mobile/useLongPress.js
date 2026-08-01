/**
 * Long-press (480ms) → enter select mode, mirroring the design source's
 * touch semantics. Desktop right-click (contextmenu) does the same so the
 * gesture is testable with a mouse. Returns props to spread on the row.
 */
import { useRef } from 'react';

export function useLongPress(onPress) {
  const timer = useRef(null);

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  return {
    onContextMenu: (e) => {
      e.preventDefault();
      onPress?.();
    },
    onTouchStart: () => {
      clear();
      timer.current = setTimeout(() => onPress?.(), 480);
    },
    onTouchEnd: clear,
    onTouchMove: clear,
  };
}
