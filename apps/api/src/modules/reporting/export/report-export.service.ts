/**
 * Report export — CSV and PDF.
 *
 * Both formats are rendered server-side from the same ReportDetail object, so
 * what the user downloads always matches what they see in the browser. The
 * rendered bytes are persisted via StorageProvider under
 *   tenants/{tid}/report_export/{savedReportIdOrNew}/{filename}
 * and the API returns the StorageProvider.toUrl() result + an expiry hint.
 *
 * Decision: CSV streams via csv-stringify; PDF uses pdfkit (matching the
 * Session 10 invoice renderer). Neither dependency is new for this session
 * outside csv-stringify; PDFKit was already in the API package.
 */
import { Buffer } from 'node:buffer';
import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '@ustowdispatch/db';
import type { ReportId, StorageProvider } from '@ustowdispatch/shared';
import { reportTitles } from '@ustowdispatch/shared';
import { stringify as csvStringify } from 'csv-stringify/sync';
import PDFDocument from 'pdfkit';
import { STORAGE_PROVIDER } from '../../storage/storage.module.js';
import type { ReportDetail } from '../reporting.types.js';

const URL_EXPIRY_HOURS = 24;

@Injectable()
export class ReportExportService {
  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  async exportCsv(
    tenantId: string,
    reportId: ReportId,
    detail: ReportDetail,
    name: string,
  ): Promise<{ url: string; filename: string; key: string; expiresAt: Date; bytes: number }> {
    const filename = `${slug(name || reportId)}-${timestamp()}.csv`;
    const buffer = Buffer.from(this.toCsv(detail), 'utf8');
    return this.persist(tenantId, reportId, filename, buffer, 'text/csv');
  }

  async exportPdf(
    tenantId: string,
    reportId: ReportId,
    detail: ReportDetail,
    name: string,
  ): Promise<{ url: string; filename: string; key: string; expiresAt: Date; bytes: number }> {
    const filename = `${slug(name || reportId)}-${timestamp()}.pdf`;
    const buffer = await this.toPdf(reportId, detail, name);
    return this.persist(tenantId, reportId, filename, buffer, 'application/pdf');
  }

  /**
   * Generic flat-table export — used by the custom report builder (Session 53),
   * whose result is an arbitrary column set rather than the fixed ReportDetail
   * shape. Reuses the same csv-stringify / pdfkit / storage path.
   */
  async exportTabular(
    tenantId: string,
    title: string,
    columns: Array<{ key: string; label: string }>,
    rows: Array<Record<string, string | number | boolean | null>>,
    format: 'csv' | 'pdf',
  ): Promise<{ url: string; filename: string; key: string; expiresAt: Date; bytes: number }> {
    const base = slug(title || 'report');
    if (format === 'csv') {
      const header = columns.map((c) => c.label);
      const body = rows.map((r) => columns.map((c) => r[c.key] ?? ''));
      const buffer = Buffer.from(csvStringify([header, ...body]), 'utf8');
      return this.persistBytes(tenantId, `${base}-${timestamp()}.csv`, buffer, 'text/csv');
    }
    const buffer = await this.tabularPdf(title, columns, rows);
    return this.persistBytes(tenantId, `${base}-${timestamp()}.pdf`, buffer, 'application/pdf');
  }

  private tabularPdf(
    title: string,
    columns: Array<{ key: string; label: string }>,
    rows: Array<Record<string, string | number | boolean | null>>,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'LETTER', margin: 48, layout: 'landscape' });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(Buffer.from(c)));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fillColor('#F05A1A').rect(0, 0, doc.page.width, 8).fill();
      doc.fillColor('#1A1E2A').rect(0, 8, doc.page.width, 48).fill();
      doc.fillColor('#F0EDE8').font('Helvetica-Bold').fontSize(16).text(title, 48, 22);
      doc.fillColor('#9CA3B5').fontSize(9).text(`generated ${new Date().toISOString()}`, 48, 42);

      doc.moveDown(4);
      const header = columns.map((c) => c.label);
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#626882').text(header.join(' · '));
      doc.font('Helvetica').fontSize(8).fillColor('#1A1E2A');
      rows.slice(0, 200).forEach((r) => {
        doc.text(columns.map((c) => String(r[c.key] ?? '')).join(' · '));
      });
      if (rows.length > 200) {
        doc
          .moveDown(0.5)
          .fillColor('#626882')
          .text(`… and ${rows.length - 200} more rows`);
      }
      doc.end();
    });
  }

  private async persistBytes(
    tenantId: string,
    fileName: string,
    bytes: Buffer,
    mimeType: string,
  ): Promise<{ url: string; filename: string; key: string; expiresAt: Date; bytes: number }> {
    const stored = await this.storage.put({
      tenantId,
      ownerType: 'report_export',
      ownerId: uuidv7(),
      fileName,
      mimeType,
      bytes,
    });
    const url = this.storage.toUrl(tenantId, stored.key);
    const expiresAt = new Date(Date.now() + URL_EXPIRY_HOURS * 60 * 60 * 1000);
    return { url, filename: fileName, key: stored.key, expiresAt, bytes: stored.sizeBytes };
  }

  /** Build a signed-ish URL for an already-persisted export key. */
  urlForKey(tenantId: string, key: string): string {
    return this.storage.toUrl(tenantId, key);
  }

  /** CSV body. KPIs first, then a blank line, then the table headers + rows. */
  toCsv(detail: ReportDetail): string {
    const sections: string[] = [];
    sections.push(
      csvStringify([
        ['Report', detail.reportId],
        ['Generated at', detail.generatedAt],
        ['Total rows', detail.totalRows],
      ]),
    );
    sections.push(
      csvStringify([
        ['KPI', 'Value', 'Tone', 'Hint'],
        ...detail.kpis.map((k) => [k.label, k.value ?? '', k.tone, k.hint ?? '']),
      ]),
    );
    if (detail.rows.length > 0) {
      const header = Object.keys(detail.rows[0] ?? {});
      sections.push(
        csvStringify([header, ...detail.rows.map((r) => header.map((h) => r[h] ?? ''))]),
      );
    }
    return sections.join('\n');
  }

  /** PDF body. Brand bar, title, KPI grid, breakdown table, data rows. */
  toPdf(reportId: ReportId, detail: ReportDetail, name: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(Buffer.from(c)));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fillColor('#F05A1A').rect(0, 0, doc.page.width, 8).fill();
      doc.fillColor('#1A1E2A').rect(0, 8, doc.page.width, 56).fill();
      doc
        .fillColor('#F0EDE8')
        .font('Helvetica-Bold')
        .fontSize(18)
        .text(reportTitles[reportId] ?? reportId, 48, 24);
      doc
        .fillColor('#9CA3B5')
        .fontSize(10)
        .text(`${name} · generated ${detail.generatedAt.toISOString()}`, 48, 46);

      doc.moveDown(4);
      doc.fillColor('#1A1E2A').fontSize(11).font('Helvetica-Bold').text('Top-line KPIs');
      doc.moveDown(0.5);
      const colWidth = (doc.page.width - 96) / 2;
      const yStart = doc.y;
      detail.kpis.forEach((kpi, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = 48 + col * colWidth;
        const y = yStart + row * 50;
        doc
          .fillColor('#1A1E2A')
          .rect(x, y, colWidth - 12, 42)
          .fillOpacity(0.05)
          .fill();
        doc
          .fillOpacity(1)
          .fillColor('#1A1E2A')
          .font('Helvetica')
          .fontSize(8)
          .text(kpi.label, x + 8, y + 6);
        doc
          .fillColor('#F05A1A')
          .font('Helvetica-Bold')
          .fontSize(14)
          .text(String(kpi.value ?? '—'), x + 8, y + 18);
        if (kpi.hint) {
          doc
            .fillColor('#626882')
            .font('Helvetica')
            .fontSize(8)
            .text(kpi.hint, x + 8, y + 32);
        }
      });
      doc.moveDown(Math.ceil(detail.kpis.length / 2) * 2);

      if (detail.breakdown.length > 0) {
        doc.fillColor('#1A1E2A').font('Helvetica-Bold').fontSize(11).text('Breakdown');
        doc.moveDown(0.3);
        doc.font('Helvetica').fontSize(9).fillColor('#1A1E2A');
        detail.breakdown.slice(0, 12).forEach((b) => {
          doc.text(`${b.label.padEnd(40).slice(0, 40)}   ${b.value.toLocaleString('en-US')}`);
        });
        doc.moveDown(1);
      }

      if (detail.rows.length > 0) {
        doc.fillColor('#1A1E2A').font('Helvetica-Bold').fontSize(11).text('Data');
        doc.moveDown(0.3);
        const header = Object.keys(detail.rows[0] ?? {});
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#626882').text(header.join(' · '));
        doc.font('Helvetica').fontSize(8).fillColor('#1A1E2A');
        detail.rows.slice(0, 60).forEach((r) => {
          doc.text(header.map((h) => String(r[h] ?? '')).join(' · '));
        });
        if (detail.rows.length > 60) {
          doc
            .moveDown(0.5)
            .fillColor('#626882')
            .text(`… and ${detail.rows.length - 60} more`);
        }
      }

      if (detail.notes.length > 0) {
        doc.moveDown(1);
        doc.fillColor('#626882').font('Helvetica-Oblique').fontSize(8);
        for (const note of detail.notes) doc.text(note);
      }

      doc.end();
    });
  }

  private async persist(
    tenantId: string,
    reportId: ReportId,
    fileName: string,
    bytes: Buffer,
    mimeType: string,
  ): Promise<{ url: string; filename: string; key: string; expiresAt: Date; bytes: number }> {
    const stored = await this.storage.put({
      tenantId,
      ownerType: 'report_export',
      ownerId: uuidv7(),
      fileName,
      mimeType,
      bytes,
    });
    const url = this.storage.toUrl(tenantId, stored.key);
    const expiresAt = new Date(Date.now() + URL_EXPIRY_HOURS * 60 * 60 * 1000);
    return { url, filename: fileName, key: stored.key, expiresAt, bytes: stored.sizeBytes };
  }
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
