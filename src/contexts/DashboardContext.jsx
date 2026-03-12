import { createContext, useContext } from "react";

const DashboardContext = createContext({ user: null });

export function DashboardProvider({ user, children }) {
  return (
    <DashboardContext.Provider value={{ user }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  return useContext(DashboardContext);
}
