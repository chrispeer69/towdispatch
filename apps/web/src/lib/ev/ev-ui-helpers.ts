/**
 * Pure presentation helpers for the EV-recovery UI (operator console + driver
 * app). No React, no fetch — unit-tested in ev-ui-helpers.spec.ts.
 *
 * The thermal warning is the one bilingual (EN/ES) string in the surface: a
 * customer or bystander being evacuated needs to understand it. The rest of
 * the operator console is English, matching every other screen (the app has
 * no i18n framework). See SESSION_48_DECISIONS.md.
 */
import type {
  EvBatteryChemistry,
  EvEquipmentRules,
  EvThermalEscalation,
  EvThermalSeverity,
} from '@ustowdispatch/shared';

export interface Badge {
  label: string;
  tone: 'danger' | 'warn' | 'ok';
}

/** The headline equipment pill. FLATBED ONLY is the conservative default. */
export function equipmentBadge(equipment: EvEquipmentRules): Badge {
  if (equipment.flatbedRequired) return { label: 'FLATBED ONLY', tone: 'danger' };
  if (equipment.wheelLiftAllowed) return { label: 'Wheel-lift OK (short)', tone: 'warn' };
  return { label: 'See OEM guidance', tone: 'warn' };
}

const SEVERITY_LABEL: Record<EvThermalSeverity, string> = {
  odor: 'Odor',
  swelling: 'Pack swelling',
  smoke: 'Smoke',
  venting: 'Venting',
  sparking: 'Sparking',
  flames: 'Flames',
};

export function severityLabel(severity: EvThermalSeverity): string {
  return SEVERITY_LABEL[severity];
}

/** odor = info; swelling = warning; everything else = critical. */
export function severityTone(severity: EvThermalSeverity): 'critical' | 'warning' | 'info' {
  if (severity === 'odor') return 'info';
  if (severity === 'swelling') return 'warning';
  return 'critical';
}

/** Ordered list of required actions for an escalation, for prompts/checklists. */
export function escalationActions(escalation: EvThermalEscalation): string[] {
  const out: string[] = [];
  if (escalation.evacRequired) out.push('Evacuate the area immediately');
  if (escalation.fireDeptNotify) out.push('Call the fire department (911)');
  if (escalation.hazmatNotify) out.push('Notify hazmat');
  if (escalation.sceneLockdown) out.push('Secure / lock down the scene');
  if (out.length === 0) out.push('Monitor — no escalation required yet');
  return out;
}

const CHEMISTRY_LABEL: Record<EvBatteryChemistry, string> = {
  li_ion: 'Lithium-ion (NMC/NCA)',
  lfp: 'LFP (lithium iron phosphate)',
  nicd: 'NiCd',
  nimh: 'NiMH',
  other: 'Other / unknown',
};

export function chemistryLabel(chem: EvBatteryChemistry | null): string {
  return chem ? CHEMISTRY_LABEL[chem] : 'Unknown';
}

/**
 * The bilingual safety line shown when a thermal event is active. EN + ES so a
 * non-English customer/bystander understands the evacuation instruction.
 */
export function bilingualThermalWarning(escalation: EvThermalEscalation): {
  en: string;
  es: string;
} {
  if (escalation.evacRequired) {
    return {
      en: 'Battery fire risk — move away from the vehicle and keep clear.',
      es: 'Riesgo de incendio de batería — aléjese del vehículo y manténgase a distancia.',
    };
  }
  return {
    en: 'Possible battery issue — stay clear of the vehicle until cleared.',
    es: 'Posible problema de batería — manténgase alejado del vehículo hasta nuevo aviso.',
  };
}

/** State-of-charge tone for the intake gauge. */
export function socTone(pct: number | null): 'danger' | 'warn' | 'ok' {
  if (pct === null) return 'warn';
  if (pct <= 5) return 'danger';
  if (pct <= 20) return 'warn';
  return 'ok';
}

export function formatKwh(kwh: number | null): string {
  return kwh === null ? '—' : `${kwh.toFixed(1)} kWh`;
}

export function formatCents(cents: number | null): string {
  return cents === null ? '—' : `$${(cents / 100).toFixed(2)}`;
}
