import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Mock dependencies
const mockUser = { id: 'u1', role: 'admin', email: 'admin@test.com' };
vi.mock('@/hooks/queries/useUsersQuery', () => ({
 useCurrentUser: () => ({ data: mockUser }),
}));

vi.mock('@/api/entities', () => ({
 User: { filter: vi.fn().mockResolvedValue([]) },
 Car: { list: vi.fn().mockResolvedValue([]), filter: vi.fn().mockResolvedValue([]) },
 FleetOwner: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/api/client', () => ({
 apiClient: { get: vi.fn().mockResolvedValue({ data: { users: [] } }) },
}));

vi.mock('@/components/fleet/CarsTab', () => ({
 default: ({ cars }) => <div data-testid="cars-tab">Cars: {cars.length}</div>,
}));
vi.mock('@/components/fleet/DriversTab', () => ({
 default: ({ drivers }) => <div data-testid="drivers-tab">Drivers: {drivers.length}</div>,
}));
vi.mock('@/components/fleet/FleetOwnersTab', () => ({
 default: ({ fleetOwners }) => <div data-testid="fleet-owners-tab">FO: {fleetOwners.length}</div>,
}));

import AdminFleet from '../AdminFleet';

function renderPage(queryClient) {
 const qc = queryClient || new QueryClient({ defaultOptions: { queries: { retry: false } } });
 return render(
 <QueryClientProvider client={qc}>
 <MemoryRouter>
 <AdminFleet />
 </MemoryRouter>
 </QueryClientProvider>
 );
}

describe('AdminFleet', () => {
 beforeEach(() => {
 vi.clearAllMocks();
 });

 it('renders the Fleet Management heading', async () => {
 renderPage();
 expect(await screen.findByText('Fleet Management')).toBeInTheDocument();
 });

 it('renders admin description text', async () => {
 renderPage();
 expect(await screen.findByText(/Manage fleet owners, vehicles and driver assignments/)).toBeInTheDocument();
 });

 it('renders Fleet Owners stat card', async () => {
 renderPage();
 //"Fleet Owners" appears in both stat card and tab trigger
 const elements = await screen.findAllByText('Fleet Owners');
 expect(elements.length).toBeGreaterThanOrEqual(1);
 });

 it('renders Total Vehicles stat card', async () => {
 renderPage();
 expect(await screen.findByText('Total Vehicles')).toBeInTheDocument();
 });

 it('renders Rented Vehicles stat card', async () => {
 renderPage();
 expect(await screen.findByText('Rented Vehicles')).toBeInTheDocument();
 });

 it('renders Available Vehicles stat card', async () => {
 renderPage();
 expect(await screen.findByText('Available Vehicles')).toBeInTheDocument();
 });

 it('renders Vehicles tab', async () => {
 renderPage();
 expect(await screen.findByText('Vehicles')).toBeInTheDocument();
 });

 it('renders Fleet Owners tab for admin', async () => {
 renderPage();
 // TabsTrigger renders"Fleet Owners" text
 const tabs = await screen.findAllByText('Fleet Owners');
 expect(tabs.length).toBeGreaterThanOrEqual(1);
 });

 it('renders Drivers tab for admin', async () => {
 renderPage();
 expect(await screen.findByText('Drivers')).toBeInTheDocument();
 });

 it('renders CarsTab component', async () => {
 renderPage();
 expect(await screen.findByTestId('cars-tab')).toBeInTheDocument();
 });

 it('shows zero counts when no data', async () => {
 renderPage();
 const zeros = await screen.findAllByText('0');
 expect(zeros.length).toBeGreaterThanOrEqual(3);
 });

 it('renders stat card values as numbers', async () => {
 renderPage();
 const values = await screen.findAllByText('0');
 values.forEach((v) => {
 expect(v.closest('.text-2xl')).not.toBeNull();
 });
 });
});
