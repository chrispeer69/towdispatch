/**
 * Unit spec for the EV-recovery UI helpers. Runs in the web vitest project.
 */
import type { EvEquipmentRules, EvThermalEscalation } from '@ustowdispatch/shared';
import { describe, expect, it } from 'vitest';
import {
  bilingualThermalWarning,
  chemistryLabel,
  equipmentBadge,
  escalationActions,
  formatCents,
  formatKwh,
  severityTone,
  socTone,
} from './ev-ui-helpers';

const flatbed: EvEquipmentRules = {
  flatbedRequired: true,
  dolliesAllowed: false,
  wheelLiftAllowed: false,
  maxWheelDownMiles: 0,
  hvIsolationRequired: false,
  reasons: [],
};
const wheelLift: EvEquipmentRules = {
  flatbedRequired: false,
  dolliesAllowed: true,
  wheelLiftAllowed: true,
  maxWheelDownMiles: 5,
  hvIsolationRequired: false,
  reasons: [],
};

const fullEscalation: EvThermalEscalation = {
  fireDeptNotify: true,
  hazmatNotify: true,
  evacRequired: true,
  sceneLockdown: true,
};
const noEscalation: EvThermalEscalation = {
  fireDeptNotify: false,
  hazmatNotify: false,
  evacRequired: false,
  sceneLockdown: false,
};

describe('equipmentBadge', () => {
  it('flatbed required → FLATBED ONLY danger pill', () => {
    expect(equipmentBadge(flatbed)).toEqual({ label: 'FLATBED ONLY', tone: 'danger' });
  });
  it('wheel-lift allowed → warn pill', () => {
    expect(equipmentBadge(wheelLift).tone).toBe('warn');
  });
});

describe('severityTone', () => {
  it('odor is info, swelling is warning, smoke+ is critical', () => {
    expect(severityTone('odor')).toBe('info');
    expect(severityTone('swelling')).toBe('warning');
    expect(severityTone('smoke')).toBe('critical');
    expect(severityTone('flames')).toBe('critical');
  });
});

describe('escalationActions', () => {
  it('full escalation lists evac first, then fire/hazmat/lockdown', () => {
    const actions = escalationActions(fullEscalation);
    expect(actions[0]).toMatch(/evacuate/i);
    expect(actions.some((a) => /fire department/i.test(a))).toBe(true);
    expect(actions.some((a) => /hazmat/i.test(a))).toBe(true);
  });
  it('no escalation → monitor only', () => {
    expect(escalationActions(noEscalation)).toEqual(['Monitor — no escalation required yet']);
  });
});

describe('bilingualThermalWarning', () => {
  it('provides both EN and ES, with ES non-empty', () => {
    const w = bilingualThermalWarning(fullEscalation);
    expect(w.en.length).toBeGreaterThan(0);
    expect(w.es.length).toBeGreaterThan(0);
    expect(w.es).not.toBe(w.en);
  });
  it('evac warning differs from the monitor warning', () => {
    expect(bilingualThermalWarning(fullEscalation).en).not.toBe(
      bilingualThermalWarning(noEscalation).en,
    );
  });
});

describe('socTone', () => {
  it('null=warn, <=5 danger, <=20 warn, else ok', () => {
    expect(socTone(null)).toBe('warn');
    expect(socTone(3)).toBe('danger');
    expect(socTone(15)).toBe('warn');
    expect(socTone(80)).toBe('ok');
  });
});

describe('formatters', () => {
  it('kwh and cents format, with em-dash for null', () => {
    expect(formatKwh(42.5)).toBe('42.5 kWh');
    expect(formatKwh(null)).toBe('—');
    expect(formatCents(1800)).toBe('$18.00');
    expect(formatCents(null)).toBe('—');
  });
  it('chemistryLabel maps known + null', () => {
    expect(chemistryLabel('lfp')).toMatch(/LFP/);
    expect(chemistryLabel(null)).toBe('Unknown');
  });
});
