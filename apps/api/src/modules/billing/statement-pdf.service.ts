import { Injectable } from '@nestjs/common';
/**
 * StatementPdfService — renders a single-account A/R statement PDF.
 * Companion to InvoicePdfService; same PDFKit setup, simpler layout.
 */
import PDFDocument from 'pdfkit';
import type { PdfLanguage } from './invoice-pdf.service.js';

interface OpenInvoice {
  invoiceNumber: string;
  issuedAt: string | null;
  dueAt: string | null;
  totalCents: number;
  balanceCents: number;
  status: string;
}

interface RenderStatementInput {
  tenant: {
    name: string;
    address?: Record<string, unknown> | null;
    phone?: string | null;
    email?: string | null;
  };
  accountName: string;
  asOf: string;
  totals: {
    currentDueCents: number;
    bucket1To30Cents: number;
    bucket31To60Cents: number;
    bucket61To90Cents: number;
    bucket91PlusCents: number;
    totalCents: number;
    invoiceCount: number;
  };
  invoices: OpenInvoice[];
  language?: PdfLanguage;
}

const LABELS_EN = {
  statement: 'STATEMENT OF ACCOUNT',
  account: 'Account',
  as_of: 'As of',
  current: 'Current',
  d1_30: '1-30 days',
  d31_60: '31-60 days',
  d61_90: '61-90 days',
  d91p: '91+ days',
  total_due: 'Total due',
  invoice: 'Invoice',
  issued: 'Issued',
  due: 'Due',
  total: 'Total',
  balance: 'Balance',
  status: 'Status',
  open_invoices: 'Open invoices',
};
const LABELS_ES = {
  statement: 'ESTADO DE CUENTA',
  account: 'Cuenta',
  as_of: 'Al',
  current: 'Actual',
  d1_30: '1-30 días',
  d31_60: '31-60 días',
  d61_90: '61-90 días',
  d91p: '91+ días',
  total_due: 'Total pendiente',
  invoice: 'Factura',
  issued: 'Emitida',
  due: 'Vence',
  total: 'Total',
  balance: 'Saldo',
  status: 'Estado',
  open_invoices: 'Facturas abiertas',
};

@Injectable()
export class StatementPdfService {
  async renderStatement(input: RenderStatementInput): Promise<Buffer> {
    const lang: PdfLanguage = input.language ?? 'en';
    const labels = lang === 'es' ? LABELS_ES : LABELS_EN;
    return new Promise<Buffer>((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', (err) => reject(err));

        doc.fontSize(20).font('Helvetica-Bold').text(input.tenant.name);
        doc.fontSize(10).font('Helvetica');
        doc.text(`${input.tenant.phone ?? ''} ${input.tenant.email ?? ''}`.trim());

        doc.moveDown(1);
        doc
          .fontSize(20)
          .font('Helvetica-Bold')
          .text(labels.statement, { align: 'right', width: 512 });
        doc
          .fontSize(10)
          .font('Helvetica')
          .text(`${labels.account}: ${input.accountName}`, { align: 'right', width: 512 });
        doc.text(`${labels.as_of}: ${input.asOf.slice(0, 10)}`, {
          align: 'right',
          width: 512,
        });

        // Aging summary
        doc.moveDown(2);
        doc.font('Helvetica-Bold').fontSize(11).text('Aging summary');
        doc.font('Helvetica').fontSize(10);
        doc.moveDown(0.4);
        const tableTop = doc.y;
        const colW = 88;
        const cols = [
          { label: labels.current, value: input.totals.currentDueCents },
          { label: labels.d1_30, value: input.totals.bucket1To30Cents },
          { label: labels.d31_60, value: input.totals.bucket31To60Cents },
          { label: labels.d61_90, value: input.totals.bucket61To90Cents },
          { label: labels.d91p, value: input.totals.bucket91PlusCents },
          { label: labels.total_due, value: input.totals.totalCents },
        ];
        cols.forEach((c, i) => {
          const x = 48 + i * colW;
          doc.font('Helvetica-Bold').text(c.label, x, tableTop, { width: colW });
        });
        cols.forEach((c, i) => {
          const x = 48 + i * colW;
          doc.font('Helvetica').text(formatMoney(c.value), x, tableTop + 14, { width: colW });
        });
        doc.y = tableTop + 36;

        // Open invoices
        doc.moveDown(2);
        doc.font('Helvetica-Bold').fontSize(11).text(labels.open_invoices);
        doc.moveDown(0.4);
        const headerY = doc.y;
        doc.font('Helvetica-Bold').fontSize(10);
        doc.text(labels.invoice, 48, headerY);
        doc.text(labels.issued, 160, headerY, { width: 80 });
        doc.text(labels.due, 250, headerY, { width: 80 });
        doc.text(labels.status, 340, headerY, { width: 100 });
        doc.text(labels.total, 430, headerY, { width: 60, align: 'right' });
        doc.text(labels.balance, 500, headerY, { width: 60, align: 'right' });
        doc
          .moveTo(48, doc.y + 4)
          .lineTo(560, doc.y + 4)
          .strokeColor('#cccccc')
          .stroke();
        doc.moveDown(0.5);
        doc.font('Helvetica').fontSize(10).fillColor('#000');
        for (const inv of input.invoices) {
          const y = doc.y + 4;
          doc.text(inv.invoiceNumber, 48, y);
          doc.text(inv.issuedAt ? inv.issuedAt.slice(0, 10) : '—', 160, y, { width: 80 });
          doc.text(inv.dueAt ? inv.dueAt.slice(0, 10) : '—', 250, y, { width: 80 });
          doc.text(inv.status, 340, y, { width: 100 });
          doc.text(formatMoney(inv.totalCents), 430, y, { width: 60, align: 'right' });
          doc.text(formatMoney(inv.balanceCents), 500, y, { width: 60, align: 'right' });
          doc.y = y + 16;
          if (doc.y > 720) doc.addPage();
        }

        doc.fontSize(9).fillColor('#888888');
        doc.text('Generated by TowCommand', 48, 760, { width: 512, align: 'center' });
        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}

function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString('en-US')}.${String(remainder).padStart(2, '0')}`;
}
