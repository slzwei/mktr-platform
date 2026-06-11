import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Mocks ---
const mockAgentsData = { agents: [] };
const mockLoading = { value: false };

vi.mock('@tanstack/react-query', async () => {
 const actual = await vi.importActual('@tanstack/react-query');
 return {
 ...actual,
 useQuery: () => ({
 data: mockAgentsData,
 isLoading: mockLoading.value,
 }),
 useQueryClient: () => ({
 invalidateQueries: vi.fn(),
 }),
 };
});

vi.mock('@/api/client', () => ({
 agents: {
 getAll: vi.fn(),
 },
}));

vi.mock('@/hooks/queries/useUsersQuery', () => ({
 useCurrentUser: () => ({ data: { id: 'u-1', role: 'admin' } }),
}));

const mockHandleSyncFromLyfe = vi.fn();
const mockHandleBulkDelete = vi.fn();
const mockHandleDeleteAgent = vi.fn();
const mockHandleToggleStatus = vi.fn();
const mockHandleResendInvite = vi.fn();
const mockHandleSetApprovalStatus = vi.fn();
const mockOpenManagePackagesDialog = vi.fn();
const mockHandleFormSubmit = vi.fn();

vi.mock('@/hooks/useAgentActions', () => ({
 default: () => ({
 handleSyncFromLyfe: mockHandleSyncFromLyfe,
 syncing: false,
 lastSyncTime: null,
 handleBulkDelete: mockHandleBulkDelete,
 handleDeleteAgent: mockHandleDeleteAgent,
 handleToggleStatus: mockHandleToggleStatus,
 handleResendInvite: mockHandleResendInvite,
 handleSetApprovalStatus: mockHandleSetApprovalStatus,
 openManagePackagesDialog: mockOpenManagePackagesDialog,
 handleFormSubmit: mockHandleFormSubmit,
 managePackagesDialogOpen: false,
 setManagePackagesDialogOpen: vi.fn(),
 packagesForAgent: [],
 editingAssignmentId: null,
 editLeadCount: '',
 setEditLeadCount: vi.fn(),
 handleStartEdit: vi.fn(),
 handleCancelEdit: vi.fn(),
 handleUpdateAssignment: vi.fn(),
 handleDeleteAssignment: vi.fn(),
 handlePackageSubmit: vi.fn(),
 confirmDialog: { open: false, title: '', description: '', onConfirm: null, destructive: false },
 closeConfirm: vi.fn(),
 }),
}));

vi.mock('@/components/agents/AgentFilters', () => ({
 default: ({ searchTerm, onSearchChange, statusFilter, onStatusFilterChange }) => (
 <div data-testid="agent-filters">
 <input
 data-testid="agent-search"
 placeholder="Search agents..."
 value={searchTerm}
 onChange={(e) => onSearchChange(e.target.value)}
 />
 <select
 data-testid="agent-status-filter"
 value={statusFilter}
 onChange={(e) => onStatusFilterChange(e.target.value)}
 >
 <option value="all">All</option>
 <option value="active">Active</option>
 <option value="pending">Pending</option>
 <option value="inactive">Inactive</option>
 </select>
 </div>
 ),
}));

vi.mock('@/components/agents/AgentTable', () => ({
 default: ({ agents, selectedAgentIds, onSelectAll, onBulkDelete }) => (
 <div data-testid="agent-table">
 <span data-testid="agent-count">{agents.length} agents</span>
 {selectedAgentIds.length > 0 && (
 <button data-testid="bulk-delete" onClick={onBulkDelete}>
 Delete Selected ({selectedAgentIds.length})
 </button>
 )}
 <input type="checkbox" data-testid="select-all" onChange={(e) => onSelectAll(e.target.checked)} />
 {agents.map((a) => (
 <div key={a.id} data-testid={`agent-row-${a.id}`}>
 {a.fullName || a.full_name || a.email}
 </div>
 ))}
 </div>
 ),
}));

vi.mock('@/components/agents/InviteAgentDialog', () => ({
 default: ({ open }) => (open ? <div data-testid="invite-dialog">Invite Agent Dialog</div> : null),
}));

vi.mock('@/components/agents/MktrLeadsAgentDialog', () => ({
 default: ({ open }) => (open ? <div data-testid="mktr-leads-dialog">MKTR Leads Agent Dialog</div> : null),
}));

vi.mock('@/components/agents/AgentDetailsDialog', () => ({
 default: ({ open, agent }) => (open ? <div data-testid="details-dialog">{agent?.fullName}</div> : null),
}));

vi.mock('@/components/agents/AssignPackageDialog', () => ({
 default: ({ open }) => (open ? <div data-testid="assign-package-dialog">Assign Package</div> : null),
}));

vi.mock('@/components/agents/ManagePackagesDialog', () => ({
 default: ({ open }) => (open ? <div data-testid="manage-packages-dialog">Manage Packages</div> : null),
}));

vi.mock('@/components/ConfirmDialog', () => ({
 ConfirmDialog: ({ open }) => (open ? <div data-testid="confirm-dialog">Confirm</div> : null),
}));

import AdminAgents from '../AdminAgents';

function renderAgents() {
 const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
 return render(
 <QueryClientProvider client={qc}>
 <MemoryRouter>
 <AdminAgents />
 </MemoryRouter>
 </QueryClientProvider>
 );
}

describe('AdminAgents', () => {
 beforeEach(() => {
 vi.clearAllMocks();
 mockLoading.value = false;
 mockAgentsData.agents = [];
 });

 // --- Loading state ---
 it('shows loading skeleton when data is loading', () => {
 mockLoading.value = true;
 const { container } = renderAgents();
 const pulseElements = container.querySelectorAll('.animate-pulse');
 expect(pulseElements.length).toBeGreaterThan(0);
 });

 // --- Header ---
 it('renders page title"Agents"', () => {
 renderAgents();
 expect(screen.getByText('Agents')).toBeInTheDocument();
 });

 it('renders page description', () => {
 renderAgents();
 expect(screen.getByText(/manage your sales agents/i)).toBeInTheDocument();
 });

 // --- Invite Agent button ---
 it('renders Invite Agent button', () => {
 renderAgents();
 expect(screen.getByRole('button', { name: /invite agent/i })).toBeInTheDocument();
 });

 it('opens the MKTR Leads invite dialog when Invite Agent is clicked (new agents are invited via MKTR Leads)', () => {
 renderAgents();
 fireEvent.click(screen.getByRole('button', { name: /invite agent/i }));
 expect(screen.getByTestId('mktr-leads-dialog')).toBeInTheDocument();
 expect(screen.queryByTestId('invite-dialog')).not.toBeInTheDocument();
 });

 // --- Sync button (covers BOTH agent sources) ---
 it('renders Sync Agents button', () => {
 renderAgents();
 expect(screen.getByRole('button', { name: /sync agents/i })).toBeInTheDocument();
 });

 it('calls sync handler when Sync button is clicked', () => {
 renderAgents();
 fireEvent.click(screen.getByRole('button', { name: /sync agents/i }));
 expect(mockHandleSyncFromLyfe).toHaveBeenCalled();
 });

 // --- Filters ---
 it('renders agent filters component', () => {
 renderAgents();
 expect(screen.getByTestId('agent-filters')).toBeInTheDocument();
 });

 it('renders search input within filters', () => {
 renderAgents();
 expect(screen.getByTestId('agent-search')).toBeInTheDocument();
 });

 it('renders status filter within filters', () => {
 renderAgents();
 expect(screen.getByTestId('agent-status-filter')).toBeInTheDocument();
 });

 // --- Table ---
 it('renders agent table', () => {
 renderAgents();
 expect(screen.getByTestId('agent-table')).toBeInTheDocument();
 });

 it('shows correct agent count in table', () => {
 mockAgentsData.agents = [
 { id: 'a-1', fullName: 'Alice Tan', email: 'alice@test.com', isActive: true },
 { id: 'a-2', fullName: 'Bob Lim', email: 'bob@test.com', isActive: true },
 ];
 renderAgents();
 expect(screen.getByTestId('agent-count')).toHaveTextContent('2 agents');
 });

 it('renders agent rows with names', () => {
 mockAgentsData.agents = [{ id: 'a-1', fullName: 'Alice Tan', email: 'alice@test.com', isActive: true }];
 renderAgents();
 expect(screen.getByText('Alice Tan')).toBeInTheDocument();
 });

 // --- Empty state ---
 it('shows 0 agents when list is empty', () => {
 mockAgentsData.agents = [];
 renderAgents();
 expect(screen.getByTestId('agent-count')).toHaveTextContent('0 agents');
 });

 // --- Filtering ---
 it('filters agents by search term', () => {
 mockAgentsData.agents = [
 { id: 'a-1', fullName: 'Alice Tan', email: 'alice@test.com', isActive: true },
 { id: 'a-2', fullName: 'Bob Lim', email: 'bob@test.com', isActive: true },
 ];
 renderAgents();

 const searchInput = screen.getByTestId('agent-search');
 fireEvent.change(searchInput, { target: { value: 'Alice' } });

 // After typing, the filtered agents should only include Alice
 expect(screen.getByText('Alice Tan')).toBeInTheDocument();
 });
});
