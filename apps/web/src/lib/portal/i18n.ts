/**
 * Lightweight en/es dictionary for the customer-facing portal (Session 32).
 *
 * The repo has no app-wide i18n framework yet, and migrating the whole staff
 * app to next-intl is out of scope for one session. But CLAUDE.md requires
 * Spanish parity for user-visible strings, and Spanish matters most exactly
 * here — tow customers. So the customer portal ships a self-contained en+es
 * dictionary; locale is detected from Accept-Language (es* → Spanish).
 *
 * See SESSION_32_DECISIONS.md.
 */
import { headers } from 'next/headers';

export type PortalLocale = 'en' | 'es';

export const PORTAL_MESSAGES = {
  en: {
    signIn: 'Sign in',
    signUp: 'Create account',
    email: 'Email',
    password: 'Password',
    forgotPassword: 'Forgot password?',
    forgotTitle: 'Reset your password',
    forgotCta: 'Send reset link',
    forgotSent: 'If that email has an account, a reset link is on its way.',
    resetTitle: 'Choose a new password',
    newPassword: 'New password',
    resetCta: 'Update password',
    resetDone: 'Your password has been updated. You can sign in now.',
    signupTitle: 'Create your portal account',
    signupCta: 'Create account',
    signupSent: 'Check your email to confirm your account, then sign in.',
    verifyChecking: 'Confirming your email…',
    verifyOk: 'Your email is confirmed. You can sign in now.',
    verifyFail: 'This confirmation link is invalid or has expired.',
    dashboardTitle: 'Your jobs',
    noJobs: 'No jobs yet.',
    invoicesTitle: 'Invoices',
    noInvoices: 'No invoices yet.',
    jobStatus: 'Status',
    driver: 'Driver',
    payInvoice: 'Pay invoice',
    balanceDue: 'Balance due',
    paid: 'Paid',
    viewJob: 'View',
    backToJobs: 'Back to jobs',
    pickup: 'Pickup',
    dropoff: 'Drop-off',
    logOut: 'Log out',
    needHelp: 'Need help?',
    emailNotVerified: 'Please confirm your email before signing in.',
    genericError: 'Something went wrong. Please try again.',
    portalNotConfigured: 'No customer portal is configured for this address.',
  },
  es: {
    signIn: 'Iniciar sesión',
    signUp: 'Crear cuenta',
    email: 'Correo electrónico',
    password: 'Contraseña',
    forgotPassword: '¿Olvidó su contraseña?',
    forgotTitle: 'Restablecer su contraseña',
    forgotCta: 'Enviar enlace',
    forgotSent: 'Si ese correo tiene una cuenta, le enviaremos un enlace.',
    resetTitle: 'Elija una nueva contraseña',
    newPassword: 'Nueva contraseña',
    resetCta: 'Actualizar contraseña',
    resetDone: 'Su contraseña se actualizó. Ya puede iniciar sesión.',
    signupTitle: 'Cree su cuenta del portal',
    signupCta: 'Crear cuenta',
    signupSent: 'Revise su correo para confirmar su cuenta y luego inicie sesión.',
    verifyChecking: 'Confirmando su correo…',
    verifyOk: 'Su correo está confirmado. Ya puede iniciar sesión.',
    verifyFail: 'Este enlace de confirmación no es válido o ha caducado.',
    dashboardTitle: 'Sus servicios',
    noJobs: 'Aún no hay servicios.',
    invoicesTitle: 'Facturas',
    noInvoices: 'Aún no hay facturas.',
    jobStatus: 'Estado',
    driver: 'Conductor',
    payInvoice: 'Pagar factura',
    balanceDue: 'Saldo pendiente',
    paid: 'Pagado',
    viewJob: 'Ver',
    backToJobs: 'Volver a servicios',
    pickup: 'Recogida',
    dropoff: 'Entrega',
    logOut: 'Cerrar sesión',
    needHelp: '¿Necesita ayuda?',
    emailNotVerified: 'Confirme su correo antes de iniciar sesión.',
    genericError: 'Algo salió mal. Inténtelo de nuevo.',
    portalNotConfigured: 'No hay un portal de clientes configurado para esta dirección.',
  },
} as const;

export type PortalMessageKey = keyof (typeof PORTAL_MESSAGES)['en'];
export type PortalMessages = Record<PortalMessageKey, string>;

/** Detect the locale from the request Accept-Language header. */
export async function getPortalLocale(): Promise<PortalLocale> {
  const accept = (await headers()).get('accept-language') ?? '';
  return /\bes\b|^es|[,\s]es[-_;]/i.test(accept) ? 'es' : 'en';
}

export function portalMessages(locale: PortalLocale): PortalMessages {
  return PORTAL_MESSAGES[locale];
}
