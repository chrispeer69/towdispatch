/**
 * Canada Expansion (Session 47) — unit-system + currency/distance/date
 * presentation helpers, surfaced under the API's common/ tree.
 *
 * The implementations are pure and shared with the web app, so they live in
 * @ustowdispatch/shared (single source of truth). This module re-exports them
 * at the path the API convention expects. Canonical storage is unchanged:
 * distance in miles, money in cents — these helpers only format for output.
 */
export {
  type SupportedCurrency,
  type SupportedLocale,
  type UnitSystem,
  celsiusToFahrenheit,
  fahrenheitToCelsius,
  formatDate,
  formatDateTime,
  formatDistance,
  formatMoney,
  formatTemperature,
  kmToMiles,
  milesToKm,
} from '@ustowdispatch/shared';
