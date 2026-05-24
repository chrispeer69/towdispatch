/**
 * Bilingual spoken-response strings for the voice driver workflow
 * (Session 45). Spanish parity is mandatory (CLAUDE.md Rule 4) — the
 * spoken response is the most user-visible string in this feature, so
 * every key ships en + es.
 *
 * Translations marked `// TODO(i18n)` are best-effort and should be
 * reviewed by a native-Spanish operator before GA.
 *
 * Templates use `{name}` placeholders filled by `renderResponse`.
 */
import type { VoiceLocale } from '@ustowdispatch/shared';

export type VoiceResponseKey =
  | 'enroute_ok'
  | 'on_scene_ok'
  | 'loaded_ok'
  | 'cleared_ok'
  | 'declined_ok'
  | 'accept_ok'
  | 'en_route_drop_ok'
  | 'arrive_drop_ok'
  | 'help_ok'
  | 'breakdown_ok'
  | 'eta_ok'
  | 'eta_no_minutes'
  | 'repeat_address'
  | 'repeat_address_none'
  | 'confirm_decline'
  | 'confirm_clear'
  | 'confirm_breakdown'
  | 'confirm_cancelled'
  | 'nothing_to_confirm'
  | 'no_active_job'
  | 'multiple_jobs'
  | 'invalid_transition'
  | 'clarify';

const RESPONSES: Readonly<Record<VoiceResponseKey, Readonly<Record<VoiceLocale, string>>>> = {
  enroute_ok: {
    en: "You're marked en route to the pickup. Drive safe.",
    es: 'Estás marcado en camino al lugar de recogida. Maneja con cuidado.',
  },
  on_scene_ok: {
    en: "You're marked on scene.",
    es: 'Estás marcado en el lugar.',
  },
  loaded_ok: {
    en: 'Vehicle marked loaded. Service is underway.',
    es: 'Vehículo marcado como cargado. El servicio está en curso.',
  },
  cleared_ok: {
    en: 'Job cleared and marked complete. Nice work.',
    es: 'Trabajo cerrado y marcado como completado. Buen trabajo.',
  },
  declined_ok: {
    en: 'Job declined. Dispatch has been notified.',
    es: 'Trabajo rechazado. Se ha notificado a despacho.',
  },
  accept_ok: {
    en: 'Job accepted. Say "en route" when you start driving.',
    es: 'Trabajo aceptado. Di "en camino" cuando empieces a conducir.',
  },
  en_route_drop_ok: {
    en: "Got it — you're en route to the drop-off.",
    es: 'Entendido, estás en camino al lugar de entrega.',
  },
  arrive_drop_ok: {
    en: "Got it — you've arrived at the drop-off.",
    es: 'Entendido, has llegado al lugar de entrega.',
  },
  help_ok: {
    en: 'Help requested. Dispatch has been notified and will reach out.',
    es: 'Ayuda solicitada. Se ha notificado a despacho y se comunicarán contigo.',
  },
  breakdown_ok: {
    en: 'Breakdown reported. Dispatch has been notified.',
    es: 'Avería reportada. Se ha notificado a despacho.',
  },
  eta_ok: {
    en: 'E.T.A. updated to {minutes} minutes.',
    es: 'Tiempo estimado actualizado a {minutes} minutos.',
  },
  eta_no_minutes: {
    en: 'How many minutes out are you?',
    es: '¿En cuántos minutos llegas?',
  },
  repeat_address: {
    en: 'The {phase} address is {address}.',
    es: 'La dirección de {phase} es {address}.', // TODO(i18n): {phase} is injected pre-localized
  },
  repeat_address_none: {
    en: "I don't have an address on file for this job.",
    es: 'No tengo una dirección registrada para este trabajo.',
  },
  confirm_decline: {
    en: 'Confirm you want to decline this job? Say yes or no.',
    es: '¿Confirmas que quieres rechazar este trabajo? Di sí o no.',
  },
  confirm_clear: {
    en: 'Confirm the job is complete and you want to clear it? Say yes or no.',
    es: '¿Confirmas que el trabajo está completo y quieres cerrarlo? Di sí o no.',
  },
  confirm_breakdown: {
    en: 'Confirm you want to report a breakdown to dispatch? Say yes or no.',
    es: '¿Confirmas que quieres reportar una avería a despacho? Di sí o no.',
  },
  confirm_cancelled: {
    en: "Okay, I won't do that.",
    es: 'De acuerdo, no lo haré.',
  },
  nothing_to_confirm: {
    en: "There's nothing waiting for confirmation right now.",
    es: 'No hay nada esperando confirmación en este momento.',
  },
  no_active_job: {
    en: "I couldn't find an active job assigned to you.",
    es: 'No pude encontrar un trabajo activo asignado a ti.',
  },
  multiple_jobs: {
    en: 'You have more than one active job. Please open the job first, then try again.',
    es: 'Tienes más de un trabajo activo. Abre el trabajo primero y vuelve a intentarlo.',
  },
  invalid_transition: {
    en: "I can't do that right now — the job is currently {status}.",
    es: 'No puedo hacer eso ahora mismo: el trabajo está actualmente en {status}.',
  },
  clarify: {
    en: "I'm not sure I understood. Could you say that again?",
    es: 'No estoy seguro de haber entendido. ¿Puedes repetirlo?',
  },
};

// Localized phase words for the repeat_address template.
const PHASE_WORDS: Readonly<Record<'pickup' | 'dropoff', Readonly<Record<VoiceLocale, string>>>> = {
  pickup: { en: 'pickup', es: 'recogida' },
  dropoff: { en: 'drop-off', es: 'entrega' },
};

export function phaseWord(phase: 'pickup' | 'dropoff', locale: VoiceLocale): string {
  return PHASE_WORDS[phase][locale];
}

/**
 * Render a localized response, substituting `{name}` placeholders.
 * `clarify` honors an English-only `suggestedRephrase` override for the
 * `en` locale (the keyword parser emits English hints); `es` always uses
 * the generic localized clarify string.
 */
export function renderResponse(
  key: VoiceResponseKey,
  locale: VoiceLocale,
  vars: Record<string, string | number> = {},
): string {
  const template = RESPONSES[key][locale];
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = vars[name];
    return v === undefined ? `{${name}}` : String(v);
  });
}
