import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

// Mock API client — vi.mock is hoisted, so we cannot reference outer variables
vi.mock('@/api/client', () => ({
 apiClient: {
 post: vi.fn(),
 get: vi.fn(),
 },
}));

vi.mock('@/api/entities', () => ({
 Campaign: {
 get: vi.fn(),
 },
}));

// Mock sub-components
vi.mock('@/components/campaigns/CampaignSignupForm', () => ({
 default: ({ onSubmit, formHeadline, formSubheadline }) => (
 <div data-testid="signup-form">
 <div>{formHeadline}</div>
 <div>{formSubheadline}</div>
 <button onClick={() => onSubmit({ name: 'Test User', email: 'test@test.com', phone: '6591234567' })}>
 Submit
 </button>
 </div>
 ),
}));

vi.mock('@/components/campaigns/ShareCampaignDialog', () => ({
 default: ({ open, campaignName }) => (open ? <div data-testid="share-dialog">Share: {campaignName}</div> : null),
}));

vi.mock('@/components/campaigns/LeadCaptureLayout', async (importOriginal) => {
 const actual = await importOriginal();
 return {
 ...actual,
 default: ({ children }) => <div data-testid="lead-capture-layout">{children}</div>,
 };
});

vi.mock('@/components/ui/TypingLoader', () => ({
 default: () => <div data-testid="typing-loader">Loading...</div>,
}));

import LeadCapture from '../LeadCapture';
import { apiClient } from '@/api/client';

const mockCampaign = {
 id: 'camp-1',
 name: 'Test Campaign',
 is_active: true,
 design_config: {
 themeColor: '#111827',
 formHeadline: 'Join Now',
 formSubheadline: 'Fill in your details',
 },
};

function renderPage(route = '/LeadCapture?campaign_id=camp-1') {
 return render(
 <MemoryRouter initialEntries={[route]}>
 <LeadCapture />
 </MemoryRouter>
 );
}

describe('LeadCapture', () => {
 beforeEach(() => {
 vi.clearAllMocks();
 apiClient.post.mockResolvedValue({ success: true });
 apiClient.get.mockImplementation((url) => {
 if (url === '/qrcodes/session') {
 return Promise.resolve({ success: false });
 }
 if (url.startsWith('/previews/public/')) {
 return Promise.resolve({ success: true, data: { campaign: mockCampaign } });
 }
 return Promise.resolve({});
 });
 });

 it('renders the layout wrapper', async () => {
 renderPage();
 expect(await screen.findByTestId('lead-capture-layout')).toBeInTheDocument();
 });

 it('shows loading state initially before campaign loads', () => {
 // Make the API hang so campaign never loads
 apiClient.get.mockImplementation(() => new Promise(() => {}));
 renderPage();
 expect(screen.getByTestId('typing-loader')).toBeInTheDocument();
 });

 it('renders signup form after campaign loads', async () => {
 renderPage();
 await waitFor(() => {
 expect(screen.getByTestId('signup-form')).toBeInTheDocument();
 });
 });

 it('displays form headline from campaign design config', async () => {
 renderPage();
 await waitFor(() => {
 expect(screen.getByText('Join Now')).toBeInTheDocument();
 });
 });

 it('displays form subheadline from campaign design config', async () => {
 renderPage();
 await waitFor(() => {
 expect(screen.getByText('Fill in your details')).toBeInTheDocument();
 });
 });

 it('shows success message after form submission', async () => {
 apiClient.post.mockResolvedValue({ success: true });

 renderPage();
 await waitFor(() => {
 expect(screen.getByTestId('signup-form')).toBeInTheDocument();
 });

 const user = userEvent.setup();
 await user.click(screen.getByText('Submit'));

 await waitFor(() => {
 expect(screen.getByText("You're all set.")).toBeInTheDocument();
 });
 });

 it('opens share dialog after successful submission', async () => {
 apiClient.post.mockResolvedValue({ success: true });

 renderPage();
 await waitFor(() => {
 expect(screen.getByTestId('signup-form')).toBeInTheDocument();
 });

 const user = userEvent.setup();
 await user.click(screen.getByText('Submit'));

 await waitFor(() => {
 expect(screen.getByTestId('share-dialog')).toBeInTheDocument();
 });
 });

 it('shows error when submission fails', async () => {
 // First post is analytics (landing), subsequent post for prospect will fail
 let postCount = 0;
 apiClient.post.mockImplementation(() => {
 postCount++;
 if (postCount <= 1) return Promise.resolve({ success: true }); // analytics
 return Promise.resolve({ success: false, message: 'Submission failed. Please try again.' });
 });

 renderPage();
 await waitFor(() => {
 expect(screen.getByTestId('signup-form')).toBeInTheDocument();
 });

 const user = userEvent.setup();
 await user.click(screen.getByText('Submit'));

 await waitFor(() => {
 expect(screen.getByText('Something went wrong')).toBeInTheDocument();
 });
 });

 it('shows error when no campaign or QR code is specified', async () => {
 apiClient.get.mockImplementation((url) => {
 if (url === '/qrcodes/session') {
 return Promise.resolve({ success: false });
 }
 return Promise.resolve({});
 });

 render(
 <MemoryRouter initialEntries={['/LeadCapture']}>
 <LeadCapture />
 </MemoryRouter>
 );

 await waitFor(() => {
 expect(screen.getByText('Something went wrong')).toBeInTheDocument();
 });
 });

 it('shows error for inactive campaign', async () => {
 const inactiveCampaign = { ...mockCampaign, is_active: false };
 apiClient.get.mockImplementation((url) => {
 if (url === '/qrcodes/session') return Promise.resolve({ success: false });
 if (url.startsWith('/previews/public/')) {
 return Promise.resolve({ success: true, data: { campaign: inactiveCampaign } });
 }
 return Promise.resolve({});
 });

 renderPage();
 await waitFor(() => {
 expect(screen.getByText('Something went wrong')).toBeInTheDocument();
 });
 });

 it('shows duplicate signup message for repeated submissions', async () => {
 let postCount = 0;
 apiClient.post.mockImplementation(() => {
 postCount++;
 if (postCount <= 1) return Promise.resolve({ success: true }); // analytics
 return Promise.reject(new Error('You have already signed up for this campaign'));
 });

 renderPage();
 await waitFor(() => {
 expect(screen.getByTestId('signup-form')).toBeInTheDocument();
 });

 const user = userEvent.setup();
 await user.click(screen.getByText('Submit'));

 await waitFor(() => {
 expect(screen.getByText('Already Registered')).toBeInTheDocument();
 });
 });

 it('fires landing analytics event on mount', async () => {
 renderPage();
 await waitFor(() => {
 expect(apiClient.post).toHaveBeenCalledWith('/analytics/events', {
 type: 'landing',
 meta: { path: '/lead-capture' },
 });
 });
 });

 it('renders share button on success screen', async () => {
 apiClient.post.mockResolvedValue({ success: true });

 renderPage();
 await waitFor(() => {
 expect(screen.getByTestId('signup-form')).toBeInTheDocument();
 });

 const user = userEvent.setup();
 await user.click(screen.getByText('Submit'));

 await waitFor(() => {
 expect(screen.getByText('Share with friends')).toBeInTheDocument();
 });
 });

 it('shows success subtitle text', async () => {
 apiClient.post.mockResolvedValue({ success: true });

 renderPage();
 await waitFor(() => {
 expect(screen.getByTestId('signup-form')).toBeInTheDocument();
 });

 const user = userEvent.setup();
 await user.click(screen.getByText('Submit'));

 await waitFor(() => {
 expect(screen.getByText('Your details have been received securely.')).toBeInTheDocument();
 });
 });

 it('fetches campaign via session endpoint first', async () => {
 apiClient.get.mockImplementation((url) => {
 if (url === '/qrcodes/session') {
 return Promise.resolve({
 success: true,
 data: { campaignId: 'camp-1', campaign: mockCampaign, qrTagId: 'qr-1' },
 });
 }
 return Promise.resolve({});
 });

 renderPage();
 await waitFor(() => {
 expect(apiClient.get).toHaveBeenCalledWith('/qrcodes/session');
 });
 });
});
