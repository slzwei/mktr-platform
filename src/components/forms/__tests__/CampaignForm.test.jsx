import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

// Polyfill ResizeObserver for jsdom
globalThis.ResizeObserver =
 globalThis.ResizeObserver ||
 class {
 observe() {}
 unobserve() {}
 disconnect() {}
 };

// Mock dependencies
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
 const actual = await vi.importActual('react-router-dom');
 return {
 ...actual,
 useNavigate: () => mockNavigate,
 useParams: () => ({}),
 useSearchParams: () => [new URLSearchParams()],
 };
});

vi.mock('@/api/entities', () => ({
 Campaign: {
 create: vi.fn().mockResolvedValue({}),
 update: vi.fn().mockResolvedValue({}),
 get: vi.fn(),
 },
}));

vi.mock('@/api/client', () => ({
 integrations: { Core: { UploadFile: vi.fn() } },
}));

vi.mock('sonner', () => ({
 toast: { success: vi.fn(), error: vi.fn() },
}));

import AdminCampaignForm from '@/pages/AdminCampaignForm';
import { Campaign } from '@/api/entities';

function renderForm() {
 return render(
 <MemoryRouter initialEntries={['/AdminCampaigns/new']}>
 <AdminCampaignForm />
 </MemoryRouter>
 );
}

describe('AdminCampaignForm', () => {
 beforeEach(() => {
 vi.clearAllMocks();
 });

 it('renders the create page heading', () => {
 renderForm();
 expect(screen.getByText('Create New Campaign')).toBeInTheDocument();
 });

 it('renders campaign name input', () => {
 renderForm();
 expect(screen.getByLabelText('Campaign Name')).toBeInTheDocument();
 });

 it('renders min age input', () => {
 renderForm();
 expect(screen.getByLabelText('Min Age')).toBeInTheDocument();
 });

 it('renders max age input', () => {
 renderForm();
 expect(screen.getByLabelText('Max Age')).toBeInTheDocument();
 });

 it('renders start date picker', () => {
 renderForm();
 expect(screen.getByText('Start Date')).toBeInTheDocument();
 });

 it('renders end date picker', () => {
 renderForm();
 expect(screen.getByText('End Date')).toBeInTheDocument();
 });

 it('renders driver commission input', () => {
 renderForm();
 expect(screen.getByLabelText('Driver Commission (SGD)')).toBeInTheDocument();
 });

 it('renders fleet owner commission input', () => {
 renderForm();
 expect(screen.getByLabelText('Fleet Owner Commission (SGD)')).toBeInTheDocument();
 });

 it('renders Cancel button', () => {
 renderForm();
 expect(screen.getByText('Cancel')).toBeInTheDocument();
 });

 it('renders Save Changes button', () => {
 renderForm();
 expect(screen.getByText('Save Changes')).toBeInTheDocument();
 });

 it('navigates back to campaigns when Cancel is clicked', () => {
 renderForm();
 fireEvent.click(screen.getByText('Cancel'));
 expect(mockNavigate).toHaveBeenCalledWith('/AdminCampaigns');
 });

 it('renders status switch', () => {
 renderForm();
 // Active/Inactive switch
 expect(screen.getByText('Active')).toBeInTheDocument();
 });

 it('renders Campaign Details card', () => {
 renderForm();
 expect(screen.getByText('Campaign Details')).toBeInTheDocument();
 });

 it('renders Commissions card', () => {
 renderForm();
 expect(screen.getByText('Commissions')).toBeInTheDocument();
 });

 it('renders Default Assignment Mode card', () => {
 renderForm();
 expect(screen.getByText('Default Assignment Mode')).toBeInTheDocument();
 });

 it('allows entering campaign name', () => {
 renderForm();
 const input = screen.getByLabelText('Campaign Name');
 fireEvent.change(input, { target: { value: 'My New Campaign' } });
 expect(input.value).toBe('My New Campaign');
 });

 it('submits form and calls Campaign.create', async () => {
 renderForm();
 const nameInput = screen.getByLabelText('Campaign Name');
 fireEvent.change(nameInput, { target: { value: 'Test Campaign', name: 'name' } });

 const form = screen.getByText('Save Changes').closest('form');
 fireEvent.submit(form);

 await waitFor(() => {
 expect(Campaign.create).toHaveBeenCalled();
 });
 });
});
