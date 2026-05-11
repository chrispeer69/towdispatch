/**
 * ReportExportService — turns a rendered report into CSV or PDF bytes and
 * persists them through the StorageProvider, returning a signed/streaming
 * URL the client can hit directly.
 *
 * Decision (documented in docs/reporting.md): we use the in-repo PDFKit
 * stack rather than @react-pdf/renderer because it is already wired for
 * invoices/statements. Standardizing on one renderer keeps dependency
 * footprint small. The TowCommand brand template is reused.
 *
 * CSV streaming: we write rows directly to a chunked Buffer rather than
 * pulling in csv-stringify because the row count is bounded by the report
 * service (max 50k rows per export). If reports grow past that we'll move
 * to a streaming writer; documented as a follow-up.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ExportResponse, ReportExportFormat, ReportId } from '@towcommand/shared';
import type { StorageProvider } from '@towcommand/shared';
import PDFDocument from 'pdfkit';
import { STORAGE_PROVIDER } from '../storage/storage.module.js';

export interface ExportInput {
  tenantId: string;
  ownerUserId: string;
  reportId: ReportId;
  reportTitle: string;
  /** Header row (column labels). */
  columns: string[];
  /** Body rows. Each entry must match the column order. */
  rows: (string | number | null)[][];
  /** Optional KPI summary to render at the top of the PDF. */
  kpis?: { label: string; value: string }[];
  format: ReportExportFormat;
}

@Injectable()
export class ReportExportService {
  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  async export(input: ExportInput): Promise<ExportResponse> {
    const bytes = input.format === 'csv' ? toCsv(input) : await toPdf(input);
    const fileName = `${input.reportId}-${new Date().toISOString().slice(0, 10)}.${input.format}`;
    const stored = await this.storage.put({
      tenantId: input.tenantId,
      ownerType: 'report_export',
      ownerId: input.ownerUserId,
      fileName,
      mimeType: input.format === 'csv' ? 'text/csv' : 'application/pdf',
      bytes,
    });
    return {
      url: this.storage.toUrl(input.tenantId, stored.key),
      filename: fileName,
      format: input.format,
      bytes: stored.sizeBytes,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
  }
}

function toCsv(input: ExportInput): Buffer {
  const escape = (v: unknown): string => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines: string[] = [];
  lines.push(input.columns.map(escape).join(','));
  for (const r of input.rows) {
    lines.push(r.map(escape).join(','));
  }
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}

function toPdf(input: ExportInput): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (e) => reject(e));

    // Brand stripe — TowCommand orange.
    doc.rect(0, 0, doc.page.width, 28).fill('#F05A1A');
    doc.fillColor('#0B0E16');
    doc.font('Helvetica-Bold').fontSize(20).text('TowCommand', 48, 40);
    doc.font('Helvetica').fontSize(10).fillColor('#1A1E2A').text(`Generated ${new Date().toUTCString()}`, 48, 64);
    doc.moveDown(2);
    doc.font('Helvetica-Bold').fontSize(16).text(input.reportTitle);
    doc.moveDown(0.5);

    if (input.kpis && input.kpis.length > 0) {
      doc.font('Helvetica-Bold').fontSize(11).text('Headline metrics');
      doc.moveDown(0.25);
      doc.font('Helvetica').fontSize(10);
      for (const kpi of input.kpis) {
        doc.text(`${kpi.label}: ${kpi.value}`);
      }
      doc.moveDown(1);
    }

    // Table — simple grid, no fancy column sizing.
    doc.font('Helvetica-Bold').fontSize(10);
    const startX = 48;
    const tableWidth = doc.page.width - 96;
    const colWidth = tableWidth / Math.max(1, input.columns.length);
    let y = doc.y;
    input.columns.forEach((c, i) => {
      doc.text(c, startX + i * colWidth, y, { width: colWidth - 4 });
    });
    y += 16;
    doc.moveTo(startX, y - 2).lineTo(startX + tableWidth, y - 2).stroke();
    doc.font('Helvetica').fontSize(9);
    for (const row of input.rows.slice(0, 1000)) {
      if (y > doc.page.height - 64) {
        doc.addPage();
        y = 48;
      }
      row.forEach((c, i) => {
        doc.text(c == null ? '' : String(c), startX + i * colWidth, y, {
          width: colWidth - 4,
        });
      });
      y += 14;
    }

    doc.end();
  });
}
