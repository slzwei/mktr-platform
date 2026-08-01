/**
 * Shell-owned state the mobile screens need to reach (theme toggle + sign-out
 * live in the More screen on mobile, but the [data-theme] root and auth
 * plumbing belong to AdminV2Shell). Separate file so pages can import the
 * hook without pulling the whole shell into their chunk.
 */
import { createContext, useContext } from 'react';

export const AdminV2ShellContext = createContext(null);

export function useAdminV2Shell() {
  return useContext(AdminV2ShellContext);
}
