/**
 * ArExportService — converts an ArReportResponse into either an .xlsx
 * (exceljs) or a .pdf (pdfkit) buffer. Both formats share the same
 * columns/rows/totals contract from the JSON response so the operator
 * sees the same data whatever they download.
 *
 * Both renderers keep a Summary header at the top (report title,
 * generated-at, filters, tenant name) and put the data table beneath.
 */
import { Injectable } from '@nestjs/common';
import type { ArReportResponse } from '@ustowdispatch/shared';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

const CURRENCY_KEYS = new Set<string>([
  'totalCents',
  'subtotalCents',
  'taxCents',
  'balanceCents',
  'paidCents',
  'current',
  'bucket1To30',
  'bucket31To60',
  'bucket61To90',
  'bucket91Plus',
  'total',
  'totalBalance',
  'billed',
  'paid',
  'outstanding',
  'voided',
  'refunded',
  'amount',
  'fees',
  'netAmount',
  'totalRevenue',
  'commission',
  'avgCommission',
]);

@Injectable()
export class ArExportService {
  // ----- Excel -----

  async renderXlsx(report: ArReportResponse, tenantName: string): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'US Tow Dispatch';
    wb.created = new Date();

    const summary = wb.addWorksheet('Summary');
    summary.addRow([tenantName]);
    summary.getCell('A1').font = { bold: true, size: 16 };
    summary.addRow([titleForReport(report.reportId)]);
    summary.getCell('A2').font = { bold: true, size: 12 };
    summary.addRow([`Generated: ${report.generatedAt}`]);
    summary.addRow([]);
    summary.addRow(['Filter', 'Value']);
    summary.getRow(5).font = { bold: true };
    for (const [k, v] of Object.entries(report.filters)) {
      summary.addRow([k, v == null ? '—' : String(v)]);
    }
    summary.columns = [{ width: 32 }, { width: 40 }];

    const detail = wb.addWorksheet('Detail');
    const headerRow = detail.addRow(report.columns.map((c) => c.label));
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF05A1A' },
    };
    headerRow.eachCell((cell) => {
      cell.font = { ...cell.font, color: { argb: 'FFFFFFFF' } };
    });
    detail.views = [{ state: 'frozen', ySplit: 1 }];

    for (const row of report.rows) {
      const values = report.columns.map((c) => {
        if (c.key === 'groupLabel') return row.groupLabel;
        const raw = row.values[c.key];
        return raw ?? '';
      });
      detail.addRow(values);
    }

    if (report.totals) {
      const totalRow = detail.addRow(
        report.columns.map((c) => {
          if (c.key === 'groupLabel') return 'TOTAL';
          return report.totals?.[c.key] ?? '';
        }),
      );
      totalRow.font = { bold: true };
      totalRow.border = { top: { style: 'thin' } };
    }

    // Apply currency formatting + auto-width.
    report.columns.forEach((c, i) => {
      const col = detail.getColumn(i + 1);
      let max = c.label.length + 2;
      col.eachCell((cell) => {
        const v = cell.value;
        if (typeof v === 'string') max = Math.max(max, v.length + 2);
        else if (typeof v === 'number') max = Math.max(max, String(v).length + 2);
        if (CURRENCY_KEYS.has(c.key) && typeof v === 'number') {
          cell.value = v / 100;
          cell.numFmt = '"$"#,##0.00';
        } else if (c.align === 'right' && typeof v === 'number') {
          cell.numFmt = '#,##0';
        }
      });
      col.width = Math.min(max, 40);
      if (c.align === 'right') col.alignment = { horizontal: 'right' };
    });

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ----- PDF -----

  async renderPdf(report: ArReportResponse, tenantName: string): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c as Buffer));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.font('Helvetica-Bold').fontSize(16).text(tenantName, { align: 'left' });
      doc.fontSize(12).text(titleForReport(report.reportId));
      doc.font('Helvetica').fontSize(9).fillColor('#666');
      doc.text(`Generated: ${report.generatedAt}`);
      const filterStr = Object.entries(report.filters)
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `${k}=${v}`)
        .join(' · ');
      if (filterStr) doc.text(`Filters: ${filterStr}`);
      doc.moveDown(0.5);
      doc.strokeColor('#F05A1A').lineWidth(1.5).moveTo(48, doc.y).lineTo(564, doc.y).stroke();
      doc.moveDown(0.5);
      doc.fillColor('#000');

      // Compute column widths proportionally.
      const pageWidth = 564 - 48;
      const widths = report.columns.map((c) => (c.key === 'groupLabel' ? 2 : 1));
      const totalW = widths.reduce((a, b) => a + b, 0);
      const colWidths = widths.map((w) => Math.floor((w / totalW) * pageWidth));

      // Header row
      doc.font('Helvetica-Bold').fontSize(9);
      let x = 48;
      report.columns.forEach((c, i) => {
        const w = colWidths[i] ?? 60;
        doc.text(c.label, x + 2, doc.y, {
          width: w - 4,
          align: c.align === 'right' ? 'right' : 'left',
          continued: i < report.columns.length - 1,
        });
        x += w;
      });
      doc.text('');
      doc.moveDown(0.3);
      doc.strokeColor('#999').lineWidth(0.5).moveTo(48, doc.y).lineTo(564, doc.y).stroke();
      doc.moveDown(0.3);

      // Data rows with page-break handling.
      doc.font('Helvetica').fontSize(9);
      for (const row of report.rows) {
        if (doc.y > 720) {
          doc.addPage();
        }
        let cx = 48;
        report.columns.forEach((c, i) => {
          const w = colWidths[i] ?? 60;
          const raw = c.key === 'groupLabel' ? row.groupLabel : row.values[c.key];
          const display = formatCell(c.key, raw);
          doc.text(display, cx + 2, doc.y, {
            width: w - 4,
            align: c.align === 'right' ? 'right' : 'left',
            continued: i < report.columns.length - 1,
          });
          cx += w;
        });
        doc.text('');
      }

      if (report.totals) {
        doc.moveDown(0.3);
        doc.strokeColor('#999').lineWidth(0.5).moveTo(48, doc.y).lineTo(564, doc.y).stroke();
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold');
        let cx = 48;
        report.columns.forEach((c, i) => {
          const w = colWidths[i] ?? 60;
          const raw = c.key === 'groupLabel' ? 'TOTAL' : report.totals?.[c.key];
          const display = formatCell(c.key, raw ?? null);
          doc.text(display, cx + 2, doc.y, {
            width: w - 4,
            align: c.align === 'right' ? 'right' : 'left',
            continued: i < report.columns.length - 1,
          });
          cx += w;
        });
        doc.text('');
      }

      // Footer
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#999')
          .text(
            `${tenantName} · ${titleForReport(report.reportId)} · Page ${i + 1} of ${range.count}`,
            48,
            760,
            { align: 'center', width: 516 },
          );
      }

      doc.end();
    });
  }
}

function titleForReport(reportId: string): string {
  switch (reportId) {
    case 'aging_summary':
      return 'A/R Aging Summary';
    case 'past_due_by_account':
      return 'Past Due by Account';
    case 'revenue_summary':
      return 'Revenue Summary';
    case 'payment_activity':
      return 'Payment Activity';
    case 'driver_commissions':
      return 'Driver Commission Earnings';
    default:
      return 'A/R Report';
  }
}

function formatCell(key: string, raw: unknown): string {
  if (raw == null) return '—';
  if (CURRENCY_KEYS.has(key) && typeof raw === 'number') {
    const sign = raw < 0 ? '-' : '';
    const abs = Math.abs(raw);
    const dollars = Math.floor(abs / 100);
    const cents = abs % 100;
    return `${sign}$${dollars.toLocaleString('en-US')}.${String(cents).padStart(2, '0')}`;
  }
  if (typeof raw === 'number') return raw.toLocaleString('en-US');
  return String(raw);
}
