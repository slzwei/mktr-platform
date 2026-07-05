/**
 * billingDocumentService — renders a Payment row into a branded MKTR PDF:
 * a RECEIPT for paid/refunded purchases, an INVOICE (payment pending) for pending
 * ones. Pure function of its inputs (no DB, no network) so it unit-tests directly;
 * billingService.getDocument owns the lookup/self-scoping and calls this.
 *
 * Layout: single A4 page, Helvetica (the wordmark PNG carries the brand), ink
 * #16181D on white with the app's brand orange #FF5A1F as the accent. Amounts are
 * SGD only; MKTR PTE. LTD. is NOT GST-registered, so the total carries an explicit
 * no-GST note instead of a tax breakdown. Dates render in Asia/Singapore.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '../assets/mktr-wordmark-dark.png');

const INK = '#16181D';
const MUTED = '#6B7280';
const FAINT = '#9CA3AF';
const ORANGE = '#FF5A1F';
const HAIRLINE = '#E5E7EB';
const GREEN = '#1F9D5B';
const GREEN_BG = '#E6F6EE';
const AMBER = '#B45309';
const AMBER_BG = '#FEF3C7';
const GRAY_BG = '#F3F4F6';

const PAGE_W = 595.28; // A4 portrait, points
const MARGIN = 50;
const RIGHT = PAGE_W - MARGIN;

/** Which document a Payment status yields — null means "no document exists". */
export function docTypeForStatus(status) {
  if (status === 'paid' || status === 'refunded') return 'receipt';
  if (status === 'pending') return 'invoice';
  return null;
}

const sgDate = new Intl.DateTimeFormat('en-SG', {
  timeZone: 'Asia/Singapore',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function formatDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? '—' : sgDate.format(date);
}

/** '200.00' | 200 → 'S$200.00' (grouped). Money is DECIMAL-as-string from Sequelize. */
function formatSGD(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 'S$—';
  return `S$${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Small rounded status badge; returns nothing (draws at x,y anchored top-left). */
function drawBadge(doc, { x, y, label, fg, bg }) {
  doc.font('Helvetica-Bold').fontSize(8);
  const padX = 8;
  const w = doc.widthOfString(label) + padX * 2;
  const h = 16;
  doc.roundedRect(x, y, w, h, 4).fill(bg);
  doc.fillColor(fg).text(label, x + padX, y + 4.5, { lineBreak: false });
  return w;
}

function agentDisplayName(agent) {
  const name = agent?.fullName || `${agent?.firstName || ''} ${agent?.lastName || ''}`.trim();
  return name || 'MKTR Agent';
}

/**
 * Render the PDF. `payment` is a Payment row (or a plain object shaped like one),
 * `agent` the resolved live User row. Returns { docType, filename, buffer }.
 * Throws if the status has no document (callers gate on docTypeForStatus first).
 */
export async function buildPurchaseDocument({ payment, agent }) {
  const docType = docTypeForStatus(payment.status);
  if (!docType) throw new Error(`no document for payment status "${payment.status}"`);

  const isReceipt = docType === 'receipt';
  const shortRef = String(payment.id).replace(/-/g, '').slice(0, 8).toUpperCase();
  const docNo = `${isReceipt ? 'RCP' : 'INV'}-${shortRef}`;
  const filename = `MKTR-${isReceipt ? 'Receipt' : 'Invoice'}-${shortRef}.pdf`;

  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: docNo, Author: 'MKTR PTE. LTD.' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // ── Header: wordmark left, document type right ─────────────────────────────
  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, MARGIN, MARGIN - 6, { width: 110 }); // 360×128 → ~39pt tall
  } else {
    doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text('> mktr_', MARGIN, MARGIN);
  }
  doc.font('Helvetica-Bold').fontSize(22).fillColor(INK);
  doc.text(isReceipt ? 'RECEIPT' : 'INVOICE', MARGIN, MARGIN + 2, { width: RIGHT - MARGIN, align: 'right' });

  doc.moveTo(MARGIN, 108).lineTo(RIGHT, 108).lineWidth(2).strokeColor(ORANGE).stroke();

  // ── From / Billed to ───────────────────────────────────────────────────────
  const colY = 128;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(FAINT).text('FROM', MARGIN, colY, { characterSpacing: 1 });
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text('MKTR PTE. LTD.', MARGIN, colY + 14);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  doc.text('UEN 202507548M', MARGIN, colY + 29);
  doc.text('Singapore', MARGIN, colY + 42);
  doc.text('mktr.sg', MARGIN, colY + 55);

  const col2X = 320;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(FAINT).text('BILLED TO', col2X, colY, { characterSpacing: 1 });
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(agentDisplayName(agent), col2X, colY + 14, { width: RIGHT - col2X });
  let billedToY = colY + 29;
  if (agent?.email) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(String(agent.email), col2X, billedToY, { width: RIGHT - col2X });
    billedToY += 13;
  }
  // Team purchase (migration 043): the payer is billed, the credits went to a team member.
  if (payment.forTeam && payment.beneficiaryName) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`For team member: ${payment.beneficiaryName}`, col2X, billedToY, { width: RIGHT - col2X });
  }

  // ── Meta row: doc no · date · status badge ─────────────────────────────────
  const metaY = 214;
  const metaCol = (x, label, value) => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(FAINT).text(label, x, metaY, { characterSpacing: 1 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(value, x, metaY + 13);
  };
  metaCol(MARGIN, isReceipt ? 'RECEIPT NO.' : 'INVOICE NO.', docNo);
  // Receipt date = settlement time (the pending→paid flip is the row's final write);
  // invoice date = when checkout created the pending row.
  metaCol(200, isReceipt ? 'PAID ON' : 'ISSUED ON', formatDate(isReceipt ? payment.updatedAt : payment.createdAt));
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(FAINT).text('STATUS', 350, metaY, { characterSpacing: 1 });
  const badge =
    payment.status === 'refunded'
      ? { label: 'REFUNDED', fg: MUTED, bg: GRAY_BG }
      : isReceipt
        ? { label: 'PAID', fg: GREEN, bg: GREEN_BG }
        : { label: 'PENDING PAYMENT', fg: AMBER, bg: AMBER_BG };
  drawBadge(doc, { x: 350, y: metaY + 11, ...badge });

  // ── Line-item table ────────────────────────────────────────────────────────
  const tableY = 272;
  const leadsX = 400;
  const amountW = 90;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(FAINT);
  doc.text('DESCRIPTION', MARGIN, tableY, { characterSpacing: 1 });
  doc.text('LEADS', leadsX, tableY, { characterSpacing: 1 });
  doc.text('AMOUNT', RIGHT - amountW, tableY, { characterSpacing: 1, width: amountW, align: 'right' });
  doc.moveTo(MARGIN, tableY + 14).lineTo(RIGHT, tableY + 14).lineWidth(0.7).strokeColor(HAIRLINE).stroke();

  const rowY = tableY + 24;
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(payment.packageName || 'Lead package', MARGIN, rowY, { width: leadsX - MARGIN - 16 });
  let rowBottom = doc.y;
  if (payment.campaignName) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Campaign: ${payment.campaignName}`, MARGIN, rowBottom + 3, { width: leadsX - MARGIN - 16 });
    rowBottom = doc.y;
  }
  doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(String(payment.leadCount ?? '—'), leadsX, rowY);
  doc.text(formatSGD(payment.amount), RIGHT - amountW, rowY, { width: amountW, align: 'right' });

  const totalRuleY = Math.max(rowBottom, rowY + 14) + 16;
  doc.moveTo(MARGIN, totalRuleY).lineTo(RIGHT, totalRuleY).lineWidth(0.7).strokeColor(HAIRLINE).stroke();

  const totalY = totalRuleY + 12;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(INK);
  doc.text(isReceipt ? 'Total paid' : 'Amount due', 280, totalY, { width: 120 });
  doc.text(formatSGD(payment.amount), RIGHT - 140, totalY, { width: 140, align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor(FAINT);
  doc.text('All amounts in SGD. MKTR PTE. LTD. is not GST-registered — no GST charged.', MARGIN, totalY + 26, {
    width: RIGHT - MARGIN,
  });

  // ── Payment / instruction block ────────────────────────────────────────────
  const noteY = totalY + 56;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(FAINT).text('PAYMENT', MARGIN, noteY, { characterSpacing: 1 });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  if (isReceipt) {
    doc.text('Paid via HitPay.', MARGIN, noteY + 13);
    if (payment.providerPaymentId) doc.text(`Payment reference: ${payment.providerPaymentId}`, MARGIN, noteY + 26);
  } else {
    doc.text('Payment has not been received yet.', MARGIN, noteY + 13);
    // '›' not '→': Helvetica is WinAnsi-encoded and has no arrow glyph.
    doc.text('Complete payment from the MKTR Leads app (Profile › Lead Store › Purchase history).', MARGIN, noteY + 26);
  }
  doc.font('Helvetica').fontSize(8).fillColor(FAINT).text(`Payment ID: ${payment.id}`, MARGIN, noteY + 44);

  // ── Footer (fixed near the page bottom) ────────────────────────────────────
  // Zero the bottom margin first: text drawn inside the margin band would otherwise
  // trigger pdfkit's automatic page-add and spill the footer onto blank pages.
  doc.page.margins.bottom = 0;
  const footY = 780;
  doc.moveTo(MARGIN, footY).lineTo(RIGHT, footY).lineWidth(0.7).strokeColor(HAIRLINE).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(FAINT);
  doc.text('This is a computer-generated document. No signature is required.', MARGIN, footY + 10, {
    width: RIGHT - MARGIN,
    align: 'center',
  });
  doc.text('MKTR PTE. LTD. · UEN 202507548M · mktr.sg', MARGIN, footY + 22, { width: RIGHT - MARGIN, align: 'center' });

  doc.end();
  const buffer = await done;
  return { docType, filename, buffer };
}
