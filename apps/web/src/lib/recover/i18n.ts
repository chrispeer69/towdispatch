/**
 * Self-contained en/es copy for the self-serve recovery portal (Session 55).
 * Mirrors lib/portal/i18n.ts: the owner's locale is read from the browser
 * (navigator.language), no cookie. Spanish parity per repo convention.
 */
export type RecoverLocale = 'en' | 'es';

export interface RecoverMessages {
  title: string;
  subtitle: string;
  plate: string;
  vin: string;
  caseNumber: string;
  lastName: string;
  findVehicle: string;
  searching: string;
  linkSent: string;
  multiMatch: string;
  noMatch: string;
  balanceDue: string;
  payNow: string;
  provideId: string;
  fullName: string;
  dob: string;
  idType: string;
  idLast4: string;
  submit: string;
  readyForGate: string;
  showAtGate: string;
  paying: string;
  payError: string;
}

const EN: RecoverMessages = {
  title: 'Recover your vehicle',
  subtitle: 'Look up your impounded vehicle, view your balance, and start your release online.',
  plate: 'License plate',
  vin: 'VIN (or last 8)',
  caseNumber: 'Case number',
  lastName: 'Owner last name',
  findVehicle: 'Find my vehicle',
  searching: 'Searching…',
  linkSent: 'We sent a secure link to the phone or email on file. Open it to continue.',
  multiMatch: 'We found more than one match. Add your VIN or case number to narrow it down.',
  noMatch: 'No matching vehicle found. Double-check your details or contact the yard.',
  balanceDue: 'Balance due',
  payNow: 'Pay now',
  provideId: 'Verify your identity',
  fullName: 'Full legal name',
  dob: 'Date of birth',
  idType: 'ID type',
  idLast4: 'Last 4 of ID',
  submit: 'Submit',
  readyForGate: 'Paid — ready for pickup',
  showAtGate: 'Show this screen and a matching photo ID to the gate operator.',
  paying: 'Processing…',
  payError: 'Payment could not be completed. Please try again.',
};

const ES: RecoverMessages = {
  title: 'Recupere su vehículo',
  subtitle: 'Busque su vehículo incautado, vea su saldo e inicie la liberación en línea.',
  plate: 'Placa',
  vin: 'VIN (o últimos 8)',
  caseNumber: 'Número de caso',
  lastName: 'Apellido del propietario',
  findVehicle: 'Buscar mi vehículo',
  searching: 'Buscando…',
  linkSent: 'Enviamos un enlace seguro al teléfono o correo registrado. Ábralo para continuar.',
  multiMatch: 'Encontramos más de una coincidencia. Agregue su VIN o número de caso.',
  noMatch: 'No se encontró ningún vehículo. Verifique sus datos o contacte al depósito.',
  balanceDue: 'Saldo pendiente',
  payNow: 'Pagar ahora',
  provideId: 'Verifique su identidad',
  fullName: 'Nombre legal completo',
  dob: 'Fecha de nacimiento',
  idType: 'Tipo de identificación',
  idLast4: 'Últimos 4 de la identificación',
  submit: 'Enviar',
  readyForGate: 'Pagado — listo para recoger',
  showAtGate: 'Muestre esta pantalla y una identificación con foto al operador.',
  paying: 'Procesando…',
  payError: 'No se pudo completar el pago. Inténtelo de nuevo.',
};

export function recoverMessages(locale: RecoverLocale): RecoverMessages {
  return locale === 'es' ? ES : EN;
}

export function detectRecoverLocale(): RecoverLocale {
  if (typeof navigator === 'undefined') return 'en';
  return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
}
