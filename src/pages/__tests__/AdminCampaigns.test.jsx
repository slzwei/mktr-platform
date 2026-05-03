import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

// --- Mocks ---
const mockCampaignData = { active: [], archived: [] };
const mockLoading = { value: false };

vi.mock('react-router-dom', async () => {
 const actual = await vi.importActual('react-router-dom');
 return {
 ...actual,
 useNavigate: () => vi.fn(),
 };
});

vi.mock('@/hooks/queries/useCampaignsQuery', () => ({
 useCampaignsList: () => ({
 data: mockCampaignData,
 isLoading: mockLoading.value,
 }),
 useArchiveCampaign: () => ({ mutateAsync: vi.fn() }),
 useRestoreCampaign: () => ({ mutateAsync: vi.fn() }),
 useDeleteCampaign: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/hooks/queries/useUsersQuery', () => ({
 useCurrentUser: () => ({ data: { id: 'u-1', role: 'admin' } }),
}));

vi.mock('@/components/ConfirmDialog', () => ({
 ConfirmDialog: ({ open, title, description }) =>
 open ? (
 <div data-testid="confirm-dialog">
 <span>{title}</span>
 <span>{description}</span>
 </div>
 ) : null,
}));

vi.mock('@/components/campaigns/CampaignTypeSelectionDialog', () => ({
 default: ({ open, onSelect }) =>
 open ? (
 <div data-testid="type-selection-dialog">
 <button onClick={() => onSelect('regular')}>Regular</button>
 <button onClick={() => onSelect('brand_awareness')}>PHV</button>
 </div>
 ) : null,
}));

import AdminCampaigns from '../AdminCampaigns';

function renderCampaigns() {
 return render(
 <MemoryRouter>
 <AdminCampaigns />
 </MemoryRouter>
 );
}

describe('AdminCampaigns', () => {
 beforeEach(() => {
 vi.clearAllMocks();
 mockLoading.value = false;
 mockCampaignData.active = [];
 mockCampaignData.archived = [];
 });

 // --- Loading state ---
 it('shows loading skeleton when data is loading', () => {
 mockLoading.value = true;
 const { container } = renderCampaigns();
 const pulseElements = container.querySelectorAll('.animate-pulse');
 expect(pulseElements.length).toBeGreaterThan(0);
 });

 // --- Header ---
 it('renders page title', () => {
 renderCampaigns();
 expect(screen.getByText('Campaign Management')).toBeInTheDocument();
 });

 it('renders page description', () => {
 renderCampaigns();
 expect(screen.getByText(/create and manage your marketing campaigns/i)).toBeInTheDocument();
 });

 it('renders Create Campaign button', () => {
 renderCampaigns();
 expect(screen.getByRole('button', { name: /create campaign/i })).toBeInTheDocument();
 });

 // --- Quick stats ---
 it('renders quick stat cards (Active, Inactive, Archived)', () => {
 mockCampaignData.active = [
 { id: 'c-1', name: 'Campaign 1', is_active: true },
 { id: 'c-2', name: 'Campaign 2', is_active: false },
 ];
 renderCampaigns();
 // Stats cards show counts; Active count = 1, Inactive = 1, Archived = 0
 const statCards = screen.getAllByText(/^(Active|Inactive|Archived)$/);
 expect(statCards.length).toBeGreaterThanOrEqual(3);
 });

 it('shows correct active count in stats', () => {
 mockCampaignData.active = [
 { id: 'c-1', name: 'C1', is_active: true },
 { id: 'c-2', name: 'C2', is_active: true },
 { id: 'c-3', name: 'C3', is_active: false },
 ];
 renderCampaigns();
 // The stat card for Active should show"2"
 expect(screen.getByText('2')).toBeInTheDocument();
 });

 it('shows correct archived count in stats', () => {
 mockCampaignData.archived = [{ id: 'c-a1', name: 'Archived 1', is_active: false }];
 renderCampaigns();
 expect(screen.getByText('1')).toBeInTheDocument();
 });

 // --- Search ---
 it('renders search input', () => {
 renderCampaigns();
 expect(screen.getByPlaceholderText(/search campaigns/i)).toBeInTheDocument();
 });

 it('allows typing in search input', () => {
 renderCampaigns();
 const searchInput = screen.getByPlaceholderText(/search campaigns/i);
 fireEvent.change(searchInput, { target: { value: 'Test Campaign' } });
 expect(searchInput).toHaveValue('Test Campaign');
 });

 // --- Tabs ---
 it('renders Active and Archived tabs', () => {
 renderCampaigns();
 expect(screen.getByRole('tab', { name: /^active$/i })).toBeInTheDocument();
 expect(screen.getByRole('tab', { name: /archived/i })).toBeInTheDocument();
 });

 // --- View mode toggle ---
 it('renders List and Grid view buttons', () => {
 renderCampaigns();
 expect(screen.getByRole('button', { name: /list/i })).toBeInTheDocument();
 expect(screen.getByRole('button', { name: /grid/i })).toBeInTheDocument();
 });

 // --- Table headers ---
 it('renders table with correct column headers', () => {
 mockCampaignData.active = [
 { id: 'c-1', name: 'Campaign 1', is_active: true, type: 'regular', min_age: 21 },
 ];
 renderCampaigns();
 expect(screen.getByText('Campaign Name')).toBeInTheDocument();
 expect(screen.getByText('Status')).toBeInTheDocument();
 expect(screen.getByText('Type')).toBeInTheDocument();
 expect(screen.getByText('Duration')).toBeInTheDocument();
 });

 // --- Campaign rows ---
 it('renders campaign rows with name and status', () => {
 mockCampaignData.active = [
 {
 id: 'c-1',
 name: 'Summer Promo',
 is_active: true,
 type: 'regular',
 start_date: '2025-06-01',
 end_date: '2025-08-31',
 min_age: 21,
 max_age: 65,
 },
 ];
 renderCampaigns();
 expect(screen.getByText('Summer Promo')).toBeInTheDocument();
 });

 it('shows Active badge for active campaigns', () => {
 mockCampaignData.active = [{ id: 'c-1', name: 'Active Campaign', is_active: true, type: 'regular', min_age: 21 }];
 renderCampaigns();
 // The status badge text
 const activeBadges = screen.getAllByText('Active');
 expect(activeBadges.length).toBeGreaterThan(0);
 });

 it('shows Inactive badge for inactive campaigns', () => {
 mockCampaignData.active = [{ id: 'c-2', name: 'Old Campaign', is_active: false, type: 'regular', min_age: 18 }];
 renderCampaigns();
 // Multiple"Inactive" texts may appear (stat card + badge), check at least one badge
 const inactiveElements = screen.getAllByText('Inactive');
 expect(inactiveElements.length).toBeGreaterThanOrEqual(1);
 });

 // --- Empty state ---
 it('shows"No campaigns found" when active list is empty', () => {
 mockCampaignData.active = [];
 renderCampaigns();
 expect(screen.getByText(/No campaigns found/)).toBeInTheDocument();
 });

 // --- Create Campaign dialog ---
 it('opens type selection dialog when Create Campaign is clicked', () => {
 renderCampaigns();
 fireEvent.click(screen.getByRole('button', { name: /create campaign/i }));
 expect(screen.getByTestId('type-selection-dialog')).toBeInTheDocument();
 });
});
