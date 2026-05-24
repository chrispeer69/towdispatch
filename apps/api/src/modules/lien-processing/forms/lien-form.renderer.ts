/**
 * LienFormPdfService — renders the statutory lien-sale notices to PDF
 * (Lien Processing, Session 23).
 *
 * ONE renderer, driven by the per-state rule config + the form type, covers
 * all 10 states × 2 form types (owner notice + publication notice) = the 20
 * logical templates. A separate file per template would be 20× the surface
 * for the same coverage; the per-state text comes from the rule config.
 *
 * No official state PDF form was sourced for this session, so each notice is
 * a compliant text document that cites the governing statute and states the
 * vehicle, the amounts owed, the redemption right, and the earliest sale
 * date. The statute citations + day-counts are best-effort and require legal
 * review before production filing — see SESSION_23_DECISIONS.md. Documents
 * are rendered in English (statutory filing language); a bilingual courtesy
 * line is included in the redemption-rights block.
 */
import { Injectable } from '@nestjs/common';
import type { LienFormType, LienImpoundSummary, LienStateRules } from '@ustowdispatch/shared';
import PDFDocument from 'pdfkit';

export interface RenderLienFormInput {
  formType: LienFormType;
  state: string;
  rules: LienStateRules;
  tenantName: string;
  caseId: string;
  openedAt: Date;
  vehicleValueTier: string;
  estimatedValueCents: number | null;
  impound: LienImpoundSummary;
  recipientName?: string | null;
  recipientAddress?: string | null;
}

const DAY_MS = 86_400_000;

@Injectable()
export class LienFormPdfService {
  /** Render the requested notice to a PDF Buffer (rendered to memory). */
  async renderForm(input: RenderLienFormInput): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'LETTER', margin: 56 });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', (err) => reject(err));

        this.draw(doc, input);

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  private draw(doc: PDFKit.PDFDocument, input: RenderLienFormInput): void {
    const isPublication = input.formType === 'publication_notice';
    const earliestSale = new Date(input.openedAt.getTime() + input.rules.minDaysToSale * DAY_MS);

    // Header — the lienholder (towing / storage operator).
    doc.fontSize(16).font('Helvetica-Bold').text(input.tenantName, { align: 'left' });
    doc.moveDown(0.2);
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#555555')
      .text(`Storage facility: ${input.impound.yardName ?? 'Operator yard'}`);
    doc.fillColor('#000000');

    // Title.
    doc.moveDown(1);
    doc
      .fontSize(15)
      .font('Helvetica-Bold')
      .text(
        isPublication
          ? `NOTICE OF LIEN SALE — PUBLICATION (${input.state})`
          : `NOTICE OF PENDING LIEN SALE (${input.state})`,
        { align: 'center' },
      );
    doc.moveDown(0.3);
    doc
      .fontSize(9)
      .font('Helvetica-Oblique')
      .fillColor('#555555')
      .text(`Issued pursuant to ${input.rules.statute}`, { align: 'center' });
    doc.fillColor('#000000');

    // Recipient block.
    doc.moveDown(1.2);
    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .text(isPublication ? 'TO:' : 'TO THE REGISTERED OWNER / LIENHOLDER:');
    doc.font('Helvetica');
    if (isPublication) {
      doc.text(
        'The registered owner, legal owner, lienholder of record, and all persons claiming an interest in the vehicle described below, whose identity or address could not be ascertained.',
      );
    } else {
      doc.text(input.recipientName ?? '[Registered owner / lienholder of record]');
      if (input.recipientAddress) doc.text(input.recipientAddress);
    }

    // Vehicle block.
    doc.moveDown(1);
    doc.font('Helvetica-Bold').text('VEHICLE SUBJECT TO LIEN SALE');
    doc.font('Helvetica');
    this.kv(doc, 'Description', input.impound.vehicleDescription);
    this.kv(doc, 'VIN', input.impound.vehicleVin ?? 'Not available');
    this.kv(
      doc,
      'License plate',
      input.impound.licensePlate
        ? `${input.impound.licensePlate}${input.impound.licenseState ? ` (${input.impound.licenseState})` : ''}`
        : 'Not available',
    );
    this.kv(doc, 'Date taken into storage', formatDay(input.impound.arrivedAt));
    this.kv(doc, 'Days in storage', String(input.impound.daysStored));
    this.kv(doc, 'Accrued charges to date', formatMoney(input.impound.accruedFeeCents));

    // Body.
    doc.moveDown(1);
    doc.font('Helvetica-Bold').text('NOTICE');
    doc.font('Helvetica');
    doc.text(
      `You are hereby notified that the above-described vehicle is being held by ${input.tenantName} and is subject to a lien for towing, storage, and related charges under ${input.rules.statute}. Unless the accrued charges are paid in full and the vehicle is reclaimed, the vehicle will be sold at a public lien sale to satisfy the lien.`,
      { align: 'left' },
    );

    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').text('RIGHT TO RECLAIM (REDEMPTION)');
    doc.font('Helvetica');
    doc.text(
      'You have the right to reclaim the vehicle at any time before the sale by paying the total charges then due. You may also have the right to contest the lien. To assert a claim or arrange payment, contact the storage facility named above without delay.',
    );
    doc
      .fontSize(8.5)
      .fillColor('#555555')
      .text(
        'Aviso: Usted tiene derecho a recuperar el vehículo pagando los cargos adeudados antes de la venta. Comuníquese de inmediato con la instalación de almacenamiento.',
      );
    doc.fontSize(10).fillColor('#000000');

    // Sale schedule.
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').text('SALE');
    doc.font('Helvetica');
    this.kv(doc, 'Case opened', formatDay(input.openedAt.toISOString()));
    this.kv(doc, 'Statutory minimum holding period', `${input.rules.minDaysToSale} days`);
    this.kv(doc, 'Sale will NOT occur before', formatDay(earliestSale.toISOString()));
    if (input.rules.publicationRequired) {
      this.kv(
        doc,
        'Publication',
        `Notice of sale will be published; sale no sooner than ${input.rules.publicationWaitDays} days after publication.`,
      );
    }

    // Signature.
    doc.moveDown(1.5);
    doc.font('Helvetica').text('_______________________________________', { continued: false });
    doc.text('Authorized agent, lienholder');
    doc.text(`Date: ${formatDay(new Date().toISOString())}`);

    // Footer disclaimer.
    doc
      .fontSize(7.5)
      .fillColor('#888888')
      .text(
        `Generated by US Tow DISPATCH for case ${input.caseId}. This document is a system-generated draft; verify statutory form and content requirements with legal counsel before filing or mailing.`,
        56,
        740,
        { width: 484, align: 'center' },
      );
    doc.fillColor('#000000');
  }

  private kv(doc: PDFKit.PDFDocument, label: string, value: string): void {
    const y = doc.y + 2;
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(`${label}:`, 56, y, { width: 180, continued: false });
    doc.font('Helvetica').fontSize(9).text(value, 240, y, { width: 300 });
  }
}

function formatMoney(cents: number): string {
  const dollars = Math.floor(Math.abs(cents) / 100);
  const remainder = Math.abs(cents) % 100;
  return `$${dollars.toLocaleString('en-US')}.${String(remainder).padStart(2, '0')}`;
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}
