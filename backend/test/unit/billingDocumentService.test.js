import '../setup.js';
import { buildPurchaseDocument, docTypeForStatus } from '../../src/services/billingDocumentService.js';

/**
 * Real-render tests for the receipt/invoice PDF builder (no mocks — pdfkit runs for
 * real). We assert the contract (docType/filename/valid PDF bytes) rather than pixel
 * layout: %PDF magic bytes, EOF marker, and that key strings survive into the PDF's
 * uncompressed text stream is NOT assumed (pdfkit deflates) — so content checks stay
 * at the metadata/shape level.
 */

const payment = (over = {}) => ({
  id: '3f2a9c1b-7d4e-4a2b-9c1d-8e5f6a7b8c9d',
  status: 'paid',
  amount: '200.00',
  currency: 'SGD',
  leadCount: 20,
  packageName: 'SG Motor — Premium',
  campaignName: 'Q3 Motor Switch',
  providerPaymentId: 'hp-pay-123',
  createdAt: new Date('2026-07-01T04:00:00Z'),
  updatedAt: new Date('2026-07-01T04:05:00Z'),
  ...over,
});

const agent = { fullName: 'Tan Wei Ming', firstName: 'Wei Ming', lastName: 'Tan', email: 'weiming@example.com' };

describe('docTypeForStatus', () => {
  test('maps paid/refunded → receipt, pending → invoice, everything else → null', () => {
    expect(docTypeForStatus('paid')).toBe('receipt');
    expect(docTypeForStatus('refunded')).toBe('receipt');
    expect(docTypeForStatus('pending')).toBe('invoice');
    for (const s of ['failed', 'expired', 'comp', 'cancelled', undefined, null]) {
      expect(docTypeForStatus(s)).toBeNull();
    }
  });
});

describe('buildPurchaseDocument', () => {
  test('paid → receipt with RCP filename and valid PDF bytes', async () => {
    const { docType, filename, buffer } = await buildPurchaseDocument({ payment: payment(), agent });
    expect(docType).toBe('receipt');
    expect(filename).toBe('MKTR-Receipt-3F2A9C1B.pdf');
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buffer.subarray(-32).toString('latin1')).toContain('%%EOF');
  });

  test('pending → invoice with INV filename', async () => {
    const { docType, filename, buffer } = await buildPurchaseDocument({ payment: payment({ status: 'pending', providerPaymentId: null }), agent });
    expect(docType).toBe('invoice');
    expect(filename).toBe('MKTR-Invoice-3F2A9C1B.pdf');
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  test('refunded → still a receipt document', async () => {
    const { docType, filename } = await buildPurchaseDocument({ payment: payment({ status: 'refunded' }), agent });
    expect(docType).toBe('receipt');
    expect(filename).toBe('MKTR-Receipt-3F2A9C1B.pdf');
  });

  test('team purchase (forTeam + beneficiaryName) renders — payer billed, beneficiary noted', async () => {
    const team = payment({ forTeam: true, beneficiaryUserId: 'ben-1', beneficiaryName: 'Ben N' });
    const { docType, buffer } = await buildPurchaseDocument({ payment: team, agent });
    expect(docType).toBe('receipt');
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  test('beneficiary view of a vanished payer renders with the generic fallback (agent=null)', async () => {
    const team = payment({ forTeam: true, beneficiaryUserId: 'ben-1', beneficiaryName: 'Ben N' });
    const { buffer } = await buildPurchaseDocument({ payment: team, agent: null });
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  test('tolerates sparse rows — no campaign, no provider ref, no email, name fallback', async () => {
    const sparse = payment({ campaignName: null, providerPaymentId: null, packageName: null });
    const { buffer } = await buildPurchaseDocument({ payment: sparse, agent: { firstName: '', lastName: '', fullName: '', email: null } });
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  test('throws for statuses that have no document', async () => {
    await expect(buildPurchaseDocument({ payment: payment({ status: 'failed' }), agent })).rejects.toThrow(/no document/);
  });
});
