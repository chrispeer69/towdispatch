import { describe, expect, it } from 'vitest';
import {
  AUDIT_PACKET_SECTION_TITLES,
  type AuditPacketData,
  DotAuditPacketRenderer,
  buildAuditPacketSections,
} from './dot-audit-packet.renderer.js';

const baseData = (): AuditPacketData => ({
  from: '2026-01-01',
  to: '2026-03-31',
  carrier: {
    id: '00000000-0000-0000-0000-000000000001',
    tenantId: '00000000-0000-0000-0000-0000000000aa',
    usdotNumber: '3456789',
    mcNumber: 'MC-100200',
    legalName: 'Acme Towing LLC',
    dbaName: 'Acme Tow',
    carrierType: 'authorized_for_hire',
    operatingClassification: ['authorized_for_hire'],
    safetyRating: 'satisfactory',
    lastAuditedAt: '2025-06-01T00:00:00.000Z',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-06-01T00:00:00.000Z',
  },
  dqViews: [
    {
      driverId: '00000000-0000-0000-0000-0000000000d1',
      firstName: 'Pat',
      lastName: 'Diaz',
      employeeNumber: 'E1',
      cdlClass: 'a',
      licenseNumber: 'D1',
      licenseState: 'TX',
      licenseExpiresAt: '2027-01-01',
      medicalCardExpiresAt: '2026-06-01',
      drugTestLastAt: '2026-01-01',
      roadTestCompletedAt: '2025-01-01',
      employmentAppSignedAt: '2024-01-01T00:00:00.000Z',
      mvrPulledAt: '2026-01-01T00:00:00.000Z',
      mvrExpiresAt: '2027-01-01T00:00:00.000Z',
      dqFileStatus: 'complete',
      complete: true,
      missing: [],
      expiring: [],
    },
  ],
  hosByDriver: [
    {
      driverId: '00000000-0000-0000-0000-0000000000d1',
      from: '2026-01-01',
      to: '2026-03-31',
      totalDrivingMinutes: 600,
      totalOnDutyMinutes: 720,
      violations: [
        {
          rule: 'driving_limit_11h',
          at: '2026-02-01T21:00:00.000Z',
          severity: 'violation',
          detail: 'over 11h',
        },
      ],
    },
  ],
  drugTests: [
    {
      id: '00000000-0000-0000-0000-0000000000f1',
      tenantId: '00000000-0000-0000-0000-0000000000aa',
      driverId: '00000000-0000-0000-0000-0000000000d1',
      testType: 'random',
      collectedAt: '2026-02-10T00:00:00.000Z',
      result: 'negative',
      lab: 'LabCorp',
      docKey: null,
      notes: null,
      createdAt: '2026-02-10T00:00:00.000Z',
      updatedAt: '2026-02-10T00:00:00.000Z',
    },
  ],
  incidents: [
    {
      id: '00000000-0000-0000-0000-0000000000e1',
      tenantId: '00000000-0000-0000-0000-0000000000aa',
      jobId: null,
      driverId: '00000000-0000-0000-0000-0000000000d1',
      truckId: null,
      occurredAt: '2026-03-01T00:00:00.000Z',
      locationText: 'I-35 MM 200',
      severity: 'injury',
      fatalities: 0,
      injuries: 1,
      hazmatRelease: false,
      towedAway: true,
      narrative: 'rear-end',
      dotReportable: true,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    },
  ],
  openDvirs: [
    {
      dvirId: '00000000-0000-0000-0000-0000000000c1',
      truckId: '00000000-0000-0000-0000-0000000000b1',
      truckUnit: 'T-12',
      driverId: '00000000-0000-0000-0000-0000000000d1',
      driverName: 'Pat Diaz',
      type: 'pre_trip',
      submittedAt: '2026-03-02T00:00:00.000Z',
      status: 'out_of_service',
      defects: [{ component: 'brakes', severity: 'out_of_service', notes: 'soft pedal' }],
    },
  ],
  driverNames: new Map([['00000000-0000-0000-0000-0000000000d1', 'Pat Diaz']]),
});

describe('buildAuditPacketSections', () => {
  it('assembles all six sections in audit order', () => {
    const sections = buildAuditPacketSections(baseData());
    expect(sections).toHaveLength(6);
    expect(sections.map((s) => s.title)).toEqual([...AUDIT_PACKET_SECTION_TITLES]);
  });

  it('includes the tenant USDOT number in the carrier section', () => {
    const sections = buildAuditPacketSections(baseData());
    const carrier = sections[0];
    expect(carrier?.lines.some((l) => l.includes('3456789'))).toBe(true);
  });

  it('flags HOS violations and DOT-recordable incidents', () => {
    const sections = buildAuditPacketSections(baseData());
    const hos = sections[2]?.lines.join('\n') ?? '';
    expect(hos).toContain('driving_limit_11h');
    const incidents = sections[5]?.lines.join('\n') ?? '';
    expect(incidents).toContain('DOT-RECORDABLE');
  });

  it('handles an empty tenant without throwing', () => {
    const empty: AuditPacketData = {
      from: '2026-01-01',
      to: '2026-01-31',
      carrier: null,
      dqViews: [],
      hosByDriver: [],
      drugTests: [],
      incidents: [],
      openDvirs: [],
      driverNames: new Map(),
    };
    const sections = buildAuditPacketSections(empty);
    expect(sections).toHaveLength(6);
  });
});

describe('DotAuditPacketRenderer.render', () => {
  it('renders a valid, non-trivial PDF buffer', async () => {
    const buf = await new DotAuditPacketRenderer().render(baseData());
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.subarray(-8).toString('latin1')).toContain('EOF');
  });

  it('renders an empty-tenant packet without throwing', async () => {
    const empty: AuditPacketData = {
      from: '2026-01-01',
      to: '2026-01-31',
      carrier: null,
      dqViews: [],
      hosByDriver: [],
      drugTests: [],
      incidents: [],
      openDvirs: [],
      driverNames: new Map(),
    };
    const buf = await new DotAuditPacketRenderer().render(empty);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
