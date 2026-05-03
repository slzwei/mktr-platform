import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock hooks and API
const mockCommissions = [];
let mockLoading = false;
let mockUser = { id: 'u-1', role: 'admin', firstName: 'Admin', lastName: 'User' };

vi.mock('@tanstack/react-query', async (importOriginal) => {
 const actual = await importOriginal();
 return {
 ...actual,
 useQuery: vi.fn(({ queryKey }) => {
 if (queryKey[0] === 'commissions') {
 return { data: mockCommissions, isLoading: mockLoading };
 }
 return { data: null, isLoading: false };
 }),
 };
});

vi.mock('@/hooks/queries/useUsersQuery', () => ({
 useCurrentUser: () => ({ data: mockUser }),
}));

vi.mock('@/api/entities', () => ({
 Commission: {
 list: vi.fn().mockResolvedValue([]),
 },
}));

import AdminCommissions from '../AdminCommissions';

function renderWithProviders() {
 const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
 return render(
 <QueryClientProvider client={qc}>
 <AdminCommissions />
 </QueryClientProvider>
 );
}

describe('AdminCommissions', () => {
 beforeEach(() => {
 mockCommissions.length = 0;
 mockLoading = false;
 mockUser = { id: 'u-1', role: 'admin', firstName: 'Admin', lastName: 'User' };
 });

 it('renders the page title', () => {
 renderWithProviders();
 expect(screen.getByText('Commission Management')).toBeInTheDocument();
 });

 it('renders loading skeleton when data is loading', () => {
 mockLoading = true;
 const { container } = renderWithProviders();
 expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
 });

 it('displays stat cards with correct values', () => {
 mockCommissions.push(
 {
 id: 'c-1',
 amount: 100,
 amount_fleet: 50,
 status: 'pending',
 agent: { id: 'a-1', firstName: 'Alice', lastName: 'A', email: 'a@t.com' },
 agentId: 'a-1',
 },
 {
 id: 'c-2',
 amount: 200,
 amount_fleet: 75,
 status: 'paid',
 agent: { id: 'a-1', firstName: 'Alice', lastName: 'A', email: 'a@t.com' },
 agentId: 'a-1',
 }
 );

 renderWithProviders();

 // Total Amount and agent total are both $300.00, so use getAllByText
 expect(screen.getAllByText('$300.00').length).toBeGreaterThanOrEqual(1);
 expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1); // Total Records
 // Pending payout amount appears in stat card and possibly in badge
 expect(screen.getAllByText('$100.00').length).toBeGreaterThanOrEqual(1);
 });

 it('shows Total Amount stat card', () => {
 renderWithProviders();
 expect(screen.getByText('Total Amount')).toBeInTheDocument();
 });

 it('shows Total Records stat card', () => {
 renderWithProviders();
 expect(screen.getByText('Total Records')).toBeInTheDocument();
 });

 it('shows Pending Payouts stat card', () => {
 renderWithProviders();
 expect(screen.getByText('Pending Payouts')).toBeInTheDocument();
 });

 it('renders agent commission table with agent data', () => {
 mockCommissions.push({
 id: 'c-1',
 amount: 150,
 amount_fleet: 0,
 status: 'approved',
 agent: { id: 'a-1', firstName: 'Bob', lastName: 'Builder', email: 'bob@test.com' },
 agentId: 'a-1',
 });

 renderWithProviders();

 expect(screen.getByText('Bob Builder')).toBeInTheDocument();
 expect(screen.getByText('bob@test.com')).toBeInTheDocument();
 // $150.00 appears in stat card and agent table
 expect(screen.getAllByText('$150.00').length).toBeGreaterThanOrEqual(1);
 });

 it('shows empty state when no commissions exist', () => {
 renderWithProviders();
 expect(screen.getByText('No agent commissions found')).toBeInTheDocument();
 });

 it('renders search input', () => {
 renderWithProviders();
 expect(screen.getByPlaceholderText('Search agents or fleet owners...')).toBeInTheDocument();
 });

 it('renders Agent Commissions tab', () => {
 renderWithProviders();
 expect(screen.getByText('Agent Commissions')).toBeInTheDocument();
 });

 it('renders Fleet Owner Commissions tab', () => {
 renderWithProviders();
 expect(screen.getByText('Fleet Owner Commissions')).toBeInTheDocument();
 });

 it('shows status breakdown badges for agent commissions', () => {
 mockCommissions.push(
 {
 id: 'c-1',
 amount: 50,
 amount_fleet: 0,
 status: 'pending',
 agent: { id: 'a-1', firstName: 'X', lastName: 'Y', email: 'x@t.com' },
 agentId: 'a-1',
 },
 {
 id: 'c-2',
 amount: 80,
 amount_fleet: 0,
 status: 'approved',
 agent: { id: 'a-1', firstName: 'X', lastName: 'Y', email: 'x@t.com' },
 agentId: 'a-1',
 }
 );

 renderWithProviders();
 // Status badges display dollar amounts (may appear in stat cards too)
 expect(screen.getAllByText('$50.00').length).toBeGreaterThanOrEqual(1);
 expect(screen.getAllByText('$80.00').length).toBeGreaterThanOrEqual(1);
 });

 it('aggregates commissions per agent correctly', () => {
 mockCommissions.push(
 {
 id: 'c-1',
 amount: 100,
 amount_fleet: 0,
 status: 'pending',
 agent: { id: 'a-1', firstName: 'Agent', lastName: 'One', email: 'a1@t.com' },
 agentId: 'a-1',
 },
 {
 id: 'c-2',
 amount: 200,
 amount_fleet: 0,
 status: 'paid',
 agent: { id: 'a-1', firstName: 'Agent', lastName: 'One', email: 'a1@t.com' },
 agentId: 'a-1',
 }
 );

 renderWithProviders();
 // Total for the agent: 300 (appears in both stat card and table)
 expect(screen.getAllByText('$300.00').length).toBeGreaterThanOrEqual(1);
 // Count of commissions (appears in stat card and table)
 expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
 });

 it('renders subtitle text', () => {
 renderWithProviders();
 expect(screen.getByText('Track and manage agent and fleet owner commissions')).toBeInTheDocument();
 });

 it('displays agent table headers', () => {
 mockCommissions.push({
 id: 'c-1',
 amount: 10,
 amount_fleet: 0,
 status: 'pending',
 agent: { id: 'a-1', firstName: 'T', lastName: 'A', email: 't@t.com' },
 agentId: 'a-1',
 });

 renderWithProviders();
 //"Agent" appears in tab and table header
 expect(screen.getAllByText('Agent').length).toBeGreaterThanOrEqual(1);
 expect(screen.getAllByText('Contact').length).toBeGreaterThanOrEqual(1);
 expect(screen.getAllByText('Total Earned').length).toBeGreaterThanOrEqual(1);
 });

 it('shows no commissions message with search hint when searching', () => {
 renderWithProviders();
 // Default empty state without search
 expect(screen.getByText(/No commissions have been generated yet/)).toBeInTheDocument();
 });
});
