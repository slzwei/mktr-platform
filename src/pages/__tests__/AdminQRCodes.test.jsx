import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/queries/useUsersQuery', () => ({
 useCurrentUser: () => ({ data: { id: 'u1', role: 'admin' } }),
}));

vi.mock('@/api/entities', () => ({
 Campaign: {
 list: vi.fn().mockResolvedValue([
 { id: 'c1', name: 'Summer Promo', status: 'active' },
 { id: 'c2', name: 'Archived Camp', status: 'archived' },
 ]),
 },
 QrTag: {
 list: vi.fn().mockResolvedValue([
 { id: 'q1', type: 'promotional', campaign_id: 'c1' },
 { id: 'q2', type: 'car', campaign_id: 'c1' },
 { id: 'q3', type: 'promotional', campaign_id: 'c1' },
 ]),
 },
}));

vi.mock('@/components/qrcodes/CampaignQRManager', () => ({
 default: ({ campaign }) => <div data-testid="qr-manager">{campaign.name}</div>,
}));
vi.mock('@/components/qrcodes/CampaignSelector', () => ({
 default: ({ campaigns, onSelect }) => (
 <div data-testid="campaign-selector">
 {campaigns.map((c) => (
 <button key={c.id} onClick={() => onSelect(c)}>
 {c.name}
 </button>
 ))}
 </div>
 ),
}));
vi.mock('@/components/qrcodes/PromotionalQRTable', () => ({
 default: ({ qrTags }) => <div data-testid="promo-table">Promo: {qrTags.length}</div>,
}));
vi.mock('@/components/qrcodes/CarQRTable', () => ({
 default: ({ qrTags }) => <div data-testid="car-table">Car: {qrTags.length}</div>,
}));

import AdminQRCodes from '../AdminQRCodes';

function renderPage() {
 const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
 return render(
 <QueryClientProvider client={qc}>
 <MemoryRouter>
 <AdminQRCodes />
 </MemoryRouter>
 </QueryClientProvider>
 );
}

describe('AdminQRCodes', () => {
 beforeEach(() => {
 vi.clearAllMocks();
 });

 it('renders the QR Code Management heading', async () => {
 renderPage();
 expect(await screen.findByText('QR Code Management')).toBeInTheDocument();
 });

 it('renders description text', async () => {
 renderPage();
 expect(await screen.findByText(/Generate and manage QR codes/)).toBeInTheDocument();
 });

 it('renders CampaignSelector component', async () => {
 renderPage();
 expect(await screen.findByTestId('campaign-selector')).toBeInTheDocument();
 });

 it('renders PromotionalQRTable', async () => {
 renderPage();
 expect(await screen.findByTestId('promo-table')).toBeInTheDocument();
 });

 it('renders CarQRTable', async () => {
 renderPage();
 expect(await screen.findByTestId('car-table')).toBeInTheDocument();
 });

 it('filters out archived campaigns', async () => {
 renderPage();
 await waitFor(() => {
 expect(screen.getByText('Summer Promo')).toBeInTheDocument();
 expect(screen.queryByText('Archived Camp')).not.toBeInTheDocument();
 });
 });

 it('separates promotional and car QR tags', async () => {
 renderPage();
 expect(await screen.findByText('Promo: 2')).toBeInTheDocument();
 expect(await screen.findByText('Car: 1')).toBeInTheDocument();
 });

 it('shows CampaignQRManager when campaign is selected', async () => {
 renderPage();
 const button = await screen.findByText('Summer Promo');
 button.click();
 expect(await screen.findByTestId('qr-manager')).toBeInTheDocument();
 });

 it('passes campaign to CampaignQRManager after selection', async () => {
 renderPage();
 const button = await screen.findByText('Summer Promo');
 button.click();
 const manager = await screen.findByTestId('qr-manager');
 expect(manager.textContent).toContain('Summer Promo');
 });
});
