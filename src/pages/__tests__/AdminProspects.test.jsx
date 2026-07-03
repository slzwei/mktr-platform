import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Mocks ---
const mockProspectsData = { prospects: [], pagination: null };
const mockCampaigns = [];
const mockProspectsLoading = { value: false };

vi.mock('@tanstack/react-query', async () => {
 const actual = await vi.importActual('@tanstack/react-query');
 return {
 ...actual,
 useQuery: ({ queryKey }) => {
 if (queryKey[0] === 'prospects') {
 return { data: mockProspectsData, isLoading: mockProspectsLoading.value };
 }
 return { data: mockCampaigns, isLoading: false };
 },
 useQueryClient: () => ({
 invalidateQueries: vi.fn(),
 }),
 };
});

vi.mock('@/hooks/queries/useUsersQuery', () => ({
 useCurrentUser: () => ({ data: { id: 'u-1', role: 'admin' } }),
}));

const mockBulkAssign = { mutateAsync: vi.fn(), isPending: false };
const mockBulkReturn = { mutateAsync: vi.fn(), isPending: false };
const mockBulkDelete = { mutateAsync: vi.fn(), isPending: false };

vi.mock('@/hooks/queries/useProspectsQuery', () => ({
 useUpdateProspect: () => ({ mutateAsync: vi.fn() }),
 useDeleteProspect: () => ({ mutateAsync: vi.fn() }),
 useBulkAssignProspects: () => mockBulkAssign,
 useBulkReturnProspects: () => mockBulkReturn,
 useBulkDeleteProspects: () => mockBulkDelete,
}));

vi.mock('@/hooks/queries/useCampaignsQuery', () => ({
 useCampaignLookup: () => ({ data: mockCampaigns }),
}));

vi.mock('@/api/entities', () => ({
 Prospect: { list: vi.fn() },
 User: { getAgents: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/hooks/use-mobile', () => ({
 useIsMobile: () => false,
}));

vi.mock('@/components/prospects/ProspectFilters', () => ({
 default: ({ filters, onFilterChange }) => (
 <div data-testid="prospect-filters">
 <button data-testid="filter-status" onClick={() => onFilterChange({ ...filters, status: 'new' })}>
 Filter Status
 </button>
 </div>
 ),
}));

vi.mock('@/components/prospects/ProspectDetails', () => ({
 default: ({ prospect, onClose }) => (
 <div data-testid="prospect-details">
 <span>{prospect.name}</span>
 <button onClick={onClose}>Close</button>
 </div>
 ),
}));

vi.mock('@/utils/normalizeProspect', async (importOriginal) => {
 // Keep the real named exports (sourceDisplay/deriveAd/deriveReferral power
 // the Source badge) and only simplify the default normalizer.
 const actual = await importOriginal();
 return {
 ...actual,
 default: (p) => ({
 id: p.id,
 name: [p.firstName, p.lastName].filter(Boolean).join(' ') || p.name || '',
 status: p.leadStatus || p.status || 'new',
 created_date: p.createdAt || new Date().toISOString(),
 source: p.leadSource || p.source || 'other',
 campaign_id: p.campaignId,
 assigned_agent_name: p.assignedAgent ? `${p.assignedAgent.firstName} ${p.assignedAgent.lastName}` : null,
 phone: p.phone || '',
 sourceMetadata: p.sourceMetadata || null,
 quarantinedAt: p.quarantinedAt || null,
 quarantineReason: p.quarantineReason || null,
 ad: actual.deriveAd(p.sourceMetadata),
 referral: actual.deriveReferral(p.sourceMetadata),
 }),
 };
});

vi.mock('@/constants/statusConfig', () => ({
 statusStyles: { new: 'bg-info/10 text-primary' },
 statusLabels: { new: 'New', contacted: 'Contacted' },
}));

import AdminProspects from '../AdminProspects';

function renderProspects() {
 const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
 return render(
 <QueryClientProvider client={qc}>
 <MemoryRouter>
 <AdminProspects />
 </MemoryRouter>
 </QueryClientProvider>
 );
}

describe('AdminProspects', () => {
 beforeEach(() => {
 vi.clearAllMocks();
 mockProspectsLoading.value = false;
 mockProspectsData.prospects = [];
 mockProspectsData.pagination = null;
 });

 // --- Loading state ---
 it('shows loading skeleton when data is loading', () => {
 mockProspectsLoading.value = true;
 const { container } = renderProspects();
 const pulseElements = container.querySelectorAll('.animate-pulse');
 expect(pulseElements.length).toBeGreaterThan(0);
 });

 // --- Empty state ---
 it('shows"No prospects found" when list is empty', () => {
 mockProspectsData.prospects = [];
 renderProspects();
 expect(screen.getByText('No prospects found')).toBeInTheDocument();
 });

 it('shows helpful subtitle in empty state', () => {
 mockProspectsData.prospects = [];
 renderProspects();
 expect(screen.getByText(/try adjusting your filters/i)).toBeInTheDocument();
 });

 // --- Header ---
 it('renders page title"Prospects"', () => {
 renderProspects();
 expect(screen.getByText('Prospects')).toBeInTheDocument();
 });

 it('renders page description', () => {
 renderProspects();
 expect(screen.getByText(/manage and track your sales prospects/i)).toBeInTheDocument();
 });

 it('renders Export CSV button', () => {
 renderProspects();
 expect(screen.getByRole('button', { name: /export csv/i })).toBeInTheDocument();
 });

 it('disables Export CSV when no prospects', () => {
 mockProspectsData.prospects = [];
 renderProspects();
 expect(screen.getByRole('button', { name: /export csv/i })).toBeDisabled();
 });

 // --- Search ---
 it('renders search input', () => {
 renderProspects();
 expect(screen.getByPlaceholderText(/search prospects/i)).toBeInTheDocument();
 });

 it('allows typing in search input', () => {
 renderProspects();
 const searchInput = screen.getByPlaceholderText(/search prospects/i);
 fireEvent.change(searchInput, { target: { value: 'John' } });
 expect(searchInput).toHaveValue('John');
 });

 // --- Filters ---
 it('renders prospect filters component', () => {
 renderProspects();
 expect(screen.getByTestId('prospect-filters')).toBeInTheDocument();
 });

 // --- Table ---
 it('renders table with correct column headers', () => {
 renderProspects();
 expect(screen.getByText('Prospect')).toBeInTheDocument();
 expect(screen.getByText('Campaign')).toBeInTheDocument();
 expect(screen.getByText('Status')).toBeInTheDocument();
 expect(screen.getByText('Date Added')).toBeInTheDocument();
 expect(screen.getByText('Source')).toBeInTheDocument();
 expect(screen.getByText('Actions')).toBeInTheDocument();
 });

 it('renders prospect rows when data is available', () => {
 mockProspectsData.prospects = [
 {
 id: 'p-1',
 firstName: 'John',
 lastName: 'Doe',
 leadStatus: 'new',
 createdAt: '2025-01-15T10:00:00Z',
 leadSource: 'website',
 campaignId: 'c-1',
 },
 ];
 renderProspects();
 expect(screen.getByText('John Doe')).toBeInTheDocument();
 });

 it('shows"Unassigned" for prospects without agents', () => {
 mockProspectsData.prospects = [
 {
 id: 'p-1',
 firstName: 'Jane',
 lastName: 'Smith',
 leadStatus: 'new',
 createdAt: '2025-01-15T10:00:00Z',
 leadSource: 'qr_code',
 },
 ];
 renderProspects();
 expect(screen.getByText('Unassigned')).toBeInTheDocument();
 });

 it('shows agent name for assigned prospects', () => {
 mockProspectsData.prospects = [
 {
 id: 'p-2',
 firstName: 'Bob',
 lastName: 'Lee',
 leadStatus: 'contacted',
 createdAt: '2025-02-01T10:00:00Z',
 assignedAgent: { firstName: 'Alice', lastName: 'Tan' },
 },
 ];
 renderProspects();
 expect(screen.getByText('Agent: Alice Tan')).toBeInTheDocument();
 });

 it('renders status badge for each prospect', () => {
 mockProspectsData.prospects = [
 {
 id: 'p-1',
 firstName: 'John',
 lastName: 'Doe',
 leadStatus: 'new',
 createdAt: '2025-01-15T10:00:00Z',
 },
 ];
 renderProspects();
 expect(screen.getByText('New')).toBeInTheDocument();
 });

 // --- Prospect detail ---
 it('opens prospect detail when row is clicked', () => {
 mockProspectsData.prospects = [
 {
 id: 'p-1',
 firstName: 'John',
 lastName: 'Doe',
 leadStatus: 'new',
 createdAt: '2025-01-15T10:00:00Z',
 },
 ];
 renderProspects();

 fireEvent.click(screen.getByText('John Doe'));
 expect(screen.getByTestId('prospect-details')).toBeInTheDocument();
 });

 // --- Delete dialog ---
 it('renders delete button for each prospect row', () => {
 mockProspectsData.prospects = [
 {
 id: 'p-1',
 firstName: 'John',
 lastName: 'Doe',
 leadStatus: 'new',
 createdAt: '2025-01-15T10:00:00Z',
 },
 ];
 renderProspects();
 const deleteButtons = screen.getAllByRole('button').filter((btn) => btn.querySelector('svg'));
 expect(deleteButtons.length).toBeGreaterThan(0);
 });

 // --- Rows per page ---
 it('renders rows per page selector', () => {
 renderProspects();
 expect(screen.getByText(/rows per page/i)).toBeInTheDocument();
 });

 // --- Selection & export ---
 const twoProspects = [
 { id: 'p-1', firstName: 'John', lastName: 'Doe', leadStatus: 'new', createdAt: '2025-01-15T10:00:00Z' },
 { id: 'p-2', firstName: 'Jane', lastName: 'Roe', leadStatus: 'new', createdAt: '2025-01-16T10:00:00Z' },
 ];

 it('renders Export PDF button', () => {
 renderProspects();
 expect(screen.getByRole('button', { name: /export pdf/i })).toBeInTheDocument();
 });

 it('renders a select-all checkbox plus one checkbox per row', () => {
 mockProspectsData.prospects = twoProspects;
 renderProspects();
 // 1 header select-all + 2 row checkboxes
 expect(screen.getAllByRole('checkbox')).toHaveLength(3);
 });

 it('selecting a row reveals the selection bar with a count and clear action', () => {
 mockProspectsData.prospects = twoProspects;
 renderProspects();
 fireEvent.click(screen.getByRole('checkbox', { name: /select john doe/i }));
 expect(screen.getByText('1 selected')).toBeInTheDocument();
 expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
 });

 it('reflects the selection count on the export buttons', () => {
 mockProspectsData.prospects = twoProspects;
 renderProspects();
 fireEvent.click(screen.getByRole('checkbox', { name: /select john doe/i }));
 expect(screen.getByRole('button', { name: /export csv \(1\)/i })).toBeInTheDocument();
 expect(screen.getByRole('button', { name: /export pdf \(1\)/i })).toBeInTheDocument();
 });

 it('select-all selects every visible row', () => {
 mockProspectsData.prospects = twoProspects;
 renderProspects();
 fireEvent.click(screen.getByRole('checkbox', { name: /select all prospects/i }));
 expect(screen.getByText('2 selected')).toBeInTheDocument();
 });

 it('clear button resets the selection', () => {
 mockProspectsData.prospects = twoProspects;
 renderProspects();
 fireEvent.click(screen.getByRole('checkbox', { name: /select john doe/i }));
 expect(screen.getByText('1 selected')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', { name: /clear/i }));
 expect(screen.queryByText(/selected/i)).not.toBeInTheDocument();
 });

 it('ticking a row checkbox does not open the detail view', () => {
 mockProspectsData.prospects = twoProspects;
 renderProspects();
 fireEvent.click(screen.getByRole('checkbox', { name: /select john doe/i }));
 expect(screen.queryByTestId('prospect-details')).not.toBeInTheDocument();
 });

 it('selection reveals the bulk action bar (assign / return to held / delete)', () => {
 mockProspectsData.prospects = twoProspects;
 renderProspects();
 fireEvent.click(screen.getByRole('checkbox', { name: /select john doe/i }));
 expect(screen.getByRole('button', { name: /assign to agent/i })).toBeInTheDocument();
 expect(screen.getByRole('button', { name: /return to held/i })).toBeInTheDocument();
 expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
 });

 it('shift-click selects the range between the anchor and the clicked row', () => {
 mockProspectsData.prospects = twoProspects;
 renderProspects();
 fireEvent.click(screen.getByRole('checkbox', { name: /select john doe/i }));
 fireEvent.click(screen.getByRole('checkbox', { name: /select jane roe/i }), { shiftKey: true });
 expect(screen.getByText('2 selected')).toBeInTheDocument();
 });

 it('changing a filter clears the selection', () => {
 mockProspectsData.prospects = twoProspects;
 renderProspects();
 fireEvent.click(screen.getByRole('checkbox', { name: /select john doe/i }));
 expect(screen.getByText('1 selected')).toBeInTheDocument();
 fireEvent.click(screen.getByTestId('filter-status'));
 expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
 });

 it('Escape clears the selection', () => {
 mockProspectsData.prospects = twoProspects;
 renderProspects();
 fireEvent.click(screen.getByRole('checkbox', { name: /select john doe/i }));
 expect(screen.getByText('1 selected')).toBeInTheDocument();
 fireEvent.keyDown(window, { key: 'Escape' });
 expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
 });

 it('marks held rows and counts them on the bar', () => {
 mockProspectsData.prospects = [
 { ...twoProspects[0], quarantinedAt: '2025-01-17T10:00:00Z', quarantineReason: 'returned_by_admin' },
 twoProspects[1],
 ];
 renderProspects();
 expect(screen.getByText(/held — returned by admin/i)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('checkbox', { name: /select all prospects/i }));
 expect(screen.getByText(/2 selected/)).toBeInTheDocument();
 expect(screen.getByText(/1 held/)).toBeInTheDocument();
 });

 // --- Source attribution badges ---
 it('shows META AD badge + campaign name for UTM-attributed leads', () => {
 mockProspectsData.prospects = [
 {
 id: 'p-1',
 firstName: 'Meta',
 lastName: 'Lead',
 leadStatus: 'new',
 createdAt: '2025-01-15T10:00:00Z',
 leadSource: 'website',
 sourceMetadata: { utm: { utm_source: 'facebook', utm_campaign: 'Jun Leads' } },
 },
 ];
 renderProspects();
 expect(screen.getByText('META AD')).toBeInTheDocument();
 expect(screen.getByText('Jun Leads')).toBeInTheDocument();
 });

 it('shows META CLICK badge for fbclid-only leads (no UTM data)', () => {
 mockProspectsData.prospects = [
 {
 id: 'p-1',
 firstName: 'Click',
 lastName: 'Lead',
 leadStatus: 'new',
 createdAt: '2025-01-15T10:00:00Z',
 leadSource: 'website',
 sourceMetadata: { fbc: 'fb.1.1718000000.AbCd' },
 },
 ];
 renderProspects();
 expect(screen.getByText('META CLICK')).toBeInTheDocument();
 });

 it('shows referrer name under the REFERRAL badge when resolved', () => {
 mockProspectsData.prospects = [
 {
 id: 'p-1',
 firstName: 'Referred',
 lastName: 'Friend',
 leadStatus: 'new',
 createdAt: '2025-01-15T10:00:00Z',
 leadSource: 'referral',
 sourceMetadata: {
 referral: { ref: 'u-1', referrerProspectId: 'u-1', referrerName: 'Jane Doe', sameCampaign: true },
 },
 },
 ];
 renderProspects();
 expect(screen.getByText('REFERRAL')).toBeInTheDocument();
 expect(screen.getByText('Jane Doe')).toBeInTheDocument();
 });

 it('plain website leads keep their badge with no detail line', () => {
 mockProspectsData.prospects = [
 {
 id: 'p-1',
 firstName: 'Plain',
 lastName: 'Lead',
 leadStatus: 'new',
 createdAt: '2025-01-15T10:00:00Z',
 leadSource: 'website',
 },
 ];
 renderProspects();
 expect(screen.getByText('WEBSITE')).toBeInTheDocument();
 expect(screen.queryByText('META AD')).not.toBeInTheDocument();
 expect(screen.queryByText('META CLICK')).not.toBeInTheDocument();
 });
});
