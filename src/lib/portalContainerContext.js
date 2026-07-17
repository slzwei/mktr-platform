import { createContext, useContext } from 'react';

/**
 * Portal-container override (Studio PR 3).
 *
 * Radix portals default to the PARENT document.body — the module-scope
 * `document` global — which breaks containment when a component tree renders
 * inside the Studio DeviceFrame's iframe (dialogs would escape into the parent
 * chrome, unstyled). Trees that need containment (the DeviceFrame) provide an
 * in-frame node here; the default `undefined` leaves every existing mount on
 * document.body, byte-identical to today.
 */
export const PortalContainerContext = createContext(undefined);
export const PortalContainerProvider = PortalContainerContext.Provider;
export const usePortalContainer = () => useContext(PortalContainerContext);
