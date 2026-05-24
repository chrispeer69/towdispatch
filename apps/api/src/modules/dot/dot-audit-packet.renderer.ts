/**
 * DotAuditPacketRenderer — Full DOT Compliance (Session 37).
 *
 * Renders the combined DOT audit packet as a single multi-section PDF over
 * a date range. Chosen over per-document PDFs (decisions doc): an FMCSA
 * compliance review wants one packet, not six downloads.
 *
 * Six sections, in audit order:
 *   1. Carrier profile cover
 *   2. Driver roster + DQ-file status
 *   3. Hours-of-service logs (violations flagged)
 *   4. DVIR records (sourced from the fleet `dvirs` table)
 *   5. Drug & alcohol test summary
 *   6. Incident reports
 *
 * English-only (legal filing language) — mirrors the lien-session decision
 * (SESSION_23_DECISIONS.md). The section MODEL (buildAuditPacketSections)
 * is separated from PDF drawing so it is unit-testable without parsing the
 * compressed PDF content stream.
 */
import { Injectable } from '@nestjs/common';
import type {
  DotCarrierProfileDto,
  DotDriverDqViewDto,
  DotDrugAlcoholTestDto,
  DotHosWeekResultDto,
  DotIncidentReportDto,
  DotOpenDvirDto,
} from '@ustowdispatch/shared';
import PDFDocument from 'pdfkit';

export interface AuditPacketData {
  from: string;
  to: string;
  carrier: DotCarrierProfileDto | null;
  dqViews: DotDriverDqViewDto[];
  hosByDriver: DotHosWeekResultDto[];
  drugTests: DotDrugAlcoholTestDto[];
  incidents: DotIncidentReportDto[];
  openDvirs: DotOpenDvirDto[];
  /** driverId → display name, for HOS / DVIR cross-reference. */
  driverNames: Map<string, string>;
}

export interface AuditPacketSection {
  title: string;
  lines: string[];
}

export const AUDIT_PACKET_SECTION_TITLES = [
  '1. Carrier Profile',
  '2. Driver Qualification Files',
  '3. Hours-of-Service Logs',
  '4. Vehicle Inspection Reports (DVIR)',
  '5. Drug & Alcohol Testing',
  '6. Incident / Accident Register',
] as const;

const fmtDate = (iso: string | null): string => (iso ? iso.slice(0, 10) : '—');

function carrierSection(data: AuditPacketData): AuditPacketSection {
  const c = data.carrier;
  const lines = c
    ? [
        `Legal name: ${c.legalName}`,
        `DBA: ${c.dbaName ?? '—'}`,
        `USDOT: ${c.usdotNumber ?? '—'}`,
        `MC #: ${c.mcNumber ?? '—'}`,
        `Carrier type: ${c.carrierType}`,
        `Operating classification: ${c.operatingClassification.join(', ') || '—'}`,
        `Safety rating: ${c.safetyRating ?? '—'}`,
        `Last audited: ${fmtDate(c.lastAuditedAt)}`,
      ]
    : ['No carrier profile on file — complete the carrier profile before an audit.'];
  return { title: AUDIT_PACKET_SECTION_TITLES[0], lines };
}

function dqSection(data: AuditPacketData): AuditPacketSection {
  const lines =
    data.dqViews.length === 0
      ? ['No drivers on file.']
      : data.dqViews.map((d) => {
          const state = d.complete ? 'COMPLETE' : `INCOMPLETE (${d.missing.join(', ')})`;
          const exp = d.expiring.length
            ? ` | expiring: ${d.expiring.map((e) => `${e.item} in ${e.daysLeft}d`).join(', ')}`
            : '';
          return `${d.lastName}, ${d.firstName} [CDL ${d.cdlClass}] — ${state}${exp}`;
        });
  return { title: AUDIT_PACKET_SECTION_TITLES[1], lines };
}

function hosSection(data: AuditPacketData): AuditPacketSection {
  if (data.hosByDriver.length === 0) {
    return { title: AUDIT_PACKET_SECTION_TITLES[2], lines: ['No HOS entries in range.'] };
  }
  const lines: string[] = [];
  for (const w of data.hosByDriver) {
    const name = data.driverNames.get(w.driverId) ?? w.driverId;
    const drvH = (w.totalDrivingMinutes / 60).toFixed(1);
    const dutyH = (w.totalOnDutyMinutes / 60).toFixed(1);
    lines.push(
      `${name}: ${drvH}h driving / ${dutyH}h on-duty — ${w.violations.length} violation(s)`,
    );
    for (const v of w.violations) {
      lines.push(
        `    • [${v.severity}] ${v.rule} @ ${v.at.slice(0, 16).replace('T', ' ')} — ${v.detail}`,
      );
    }
  }
  return { title: AUDIT_PACKET_SECTION_TITLES[2], lines };
}

function dvirSection(data: AuditPacketData): AuditPacketSection {
  const lines =
    data.openDvirs.length === 0
      ? ['No open DVIR defects.']
      : data.openDvirs.map((d) => {
          const defects = d.defects.map((x) => `${x.component} (${x.severity})`).join('; ');
          return `Unit ${d.truckUnit ?? d.truckId.slice(0, 8)} — ${d.driverName} — ${d.type} ${fmtDate(d.submittedAt)} [${d.status}] : ${defects || '—'}`;
        });
  return { title: AUDIT_PACKET_SECTION_TITLES[3], lines };
}

function drugSection(data: AuditPacketData): AuditPacketSection {
  if (data.drugTests.length === 0) {
    return { title: AUDIT_PACKET_SECTION_TITLES[4], lines: ['No drug/alcohol tests in range.'] };
  }
  const byResult = new Map<string, number>();
  for (const t of data.drugTests) byResult.set(t.result, (byResult.get(t.result) ?? 0) + 1);
  const summary = `Summary: ${[...byResult.entries()].map(([k, v]) => `${k}=${v}`).join(', ')}`;
  const rows = data.drugTests.map((t) => {
    const name = data.driverNames.get(t.driverId) ?? t.driverId;
    return `${fmtDate(t.collectedAt)} — ${name} — ${t.testType} — ${t.result.toUpperCase()}`;
  });
  return { title: AUDIT_PACKET_SECTION_TITLES[4], lines: [summary, ...rows] };
}

function incidentSection(data: AuditPacketData): AuditPacketSection {
  const lines =
    data.incidents.length === 0
      ? ['No incidents in range.']
      : data.incidents.map((i) => {
          const flag = i.dotReportable ? 'DOT-RECORDABLE' : 'non-recordable';
          return `${fmtDate(i.occurredAt)} — ${i.severity} — ${i.fatalities}F/${i.injuries}I${i.towedAway ? ' towed' : ''}${i.hazmatRelease ? ' hazmat' : ''} [${flag}] — ${i.locationText ?? '—'}`;
        });
  return { title: AUDIT_PACKET_SECTION_TITLES[5], lines };
}

/** Pure: assemble the ordered section model from the gathered data. */
export function buildAuditPacketSections(data: AuditPacketData): AuditPacketSection[] {
  return [
    carrierSection(data),
    dqSection(data),
    hosSection(data),
    dvirSection(data),
    drugSection(data),
    incidentSection(data),
  ];
}

@Injectable()
export class DotAuditPacketRenderer {
  render(data: AuditPacketData): Promise<Buffer> {
    const sections = buildAuditPacketSections(data);
    return new Promise<Buffer>((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', (err) => reject(err));

        // Cover heading.
        doc.fontSize(20).text('DOT Compliance Audit Packet', { align: 'left' });
        doc.moveDown(0.3);
        doc
          .fontSize(11)
          .fillColor('#444')
          .text(`Coverage period: ${data.from} to ${data.to}`)
          .text(`Generated: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`)
          .fillColor('#000');
        doc.moveDown(0.8);

        sections.forEach((section, idx) => {
          if (idx > 0) doc.moveDown(0.8);
          doc.fontSize(14).fillColor('#111').text(section.title);
          doc.moveDown(0.2);
          doc.fontSize(10).fillColor('#000');
          for (const line of section.lines) {
            doc.text(line, { width: 515 });
          }
          // Page break before the larger sections so each starts clean.
          if (idx < sections.length - 1 && doc.y > 660) doc.addPage();
        });

        doc.end();
      } catch (err) {
        reject(err as Error);
      }
    });
  }
}
