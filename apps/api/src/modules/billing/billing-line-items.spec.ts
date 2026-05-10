import { describe, expect, it } from 'vitest';
import type { RateQuote } from '@towcommand/shared';
import { mapRateCodeToLineType, rateQuoteToInvoiceLineItems } from './billing-line-items.js';

describe('mapRateCodeToLineType', () => {
  it('maps "base" to service', () => {
    expect(mapRateCodeToLineType('base')).toBe('service');
  });
  it('maps "mileage" to mileage_loaded', () => {
    expect(mapRateCodeToLineType('mileage')).toBe('mileage_loaded');
  });
  it('maps "after_hours" to after_hours', () => {
    expect(mapRateCodeToLineType('after_hours')).toBe('after_hours');
  });
  it('maps a night surcharge to after_hours', () => {
    expect(mapRateCodeToLineType('night_surcharge')).toBe('after_hours');
  });
  it('maps "wheel_lift" to equipment_surcharge', () => {
    expect(mapRateCodeToLineType('wheel_lift')).toBe('equipment_surcharge');
  });
  it('falls back to custom for unknown codes', () => {
    expect(mapRateCodeToLineType('martian_levy')).toBe('custom');
  });
});

describe('rateQuoteToInvoiceLineItems', () => {
  const quote: RateQuote = {
    serviceType: 'tow',
    vehicleClass: 'light_duty',
    rateSheetId: null,
    rateSheetName: null,
    source: 'tenant_default',
    distanceMiles: 12,
    lineItems: [
      { code: 'base', label: 'Tow base fee', amountCents: 9500 },
      { code: 'mileage', label: 'Mileage (12 mi @ $4.50/mi)', amountCents: 5400, quantity: 12, unit: 'mi' },
      { code: 'admin_fee', label: 'Admin fee', amountCents: 500 },
    ],
    subtotalCents: 15400,
    totalCents: 15400,
    calculationTrace: [],
    currency: 'USD',
  };

  it('emits one draft line per rate-engine line item', () => {
    const lines = rateQuoteToInvoiceLineItems(quote);
    expect(lines.length).toBe(3);
  });
  it('preserves the lineTotalCents of every line', () => {
    const lines = rateQuoteToInvoiceLineItems(quote);
    expect(lines[0]?.lineTotalCents).toBe(9500);
    expect(lines[1]?.lineTotalCents).toBe(5400);
    expect(lines[2]?.lineTotalCents).toBe(500);
  });
  it('infers unit price from quantity', () => {
    const lines = rateQuoteToInvoiceLineItems(quote);
    // mileage: 5400 / 12 = 450
    expect(lines[1]?.unitPriceCents).toBe(450);
  });
  it('captures rate code as rate_rule_id for provenance', () => {
    const lines = rateQuoteToInvoiceLineItems(quote);
    expect(lines[0]?.rateRuleId).toBe('base');
    expect(lines[1]?.rateRuleId).toBe('mileage');
    expect(lines[2]?.rateRuleId).toBe('admin_fee');
  });
});
