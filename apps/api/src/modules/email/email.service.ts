/**
 * EmailService — single outbound email seam.
 *
 * Transport selection (decided on first send, never at module load):
 *   • SENDGRID_API_KEY non-empty  → SendGrid HTTP API via @sendgrid/mail
 *   • otherwise                   → nodemailer SMTP (mailhog in dev)
 *
 * Lazy init avoids the prior bug where the module-load read of SMTP_* env
 * masked the fact that SENDGRID_API_KEY was set in Railway. Errors are
 * logged through pino (via ConfigService.logger) with the full SendGrid
 * response body so deliverability problems are visible in production logs
 * instead of being swallowed.
 */
import { Injectable, Logger } from '@nestjs/common';
import sgMail, { type MailDataRequired, type ResponseError } from '@sendgrid/mail';
import nodemailer, { type Transporter } from 'nodemailer';
import { ConfigService } from '../../config/config.service.js';
import { TemplateRenderer } from './template-renderer.service.js';

const BRAND = {
  productName: 'Tow Dispatch',
  orange: '#F05A1A',
  steel: '#1A1E2A',
};

interface BrandVars {
  productName: string;
  orange: string;
  steel: string;
}

interface SendArgs {
  to: string;
  subject: string;
  template: string;
  variables: Record<string, unknown>;
}

export interface SendDiagnostic {
  ok: boolean;
  provider: 'sendgrid' | 'smtp';
  attempts: number;
  statusCode?: number | undefined;
  messageId?: string | undefined;
  errorBody?: unknown;
  errorMessage?: string | undefined;
}

const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 400;

@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);
  private sgInitialized = false;
  private smtpTransporter: Transporter | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly renderer: TemplateRenderer,
  ) {}

  async sendVerificationEmail(opts: {
    to: string;
    name: string;
    tenantName: string;
    token: string;
  }): Promise<void> {
    const url = this.urlFor('/verify-email', { token: opts.token });
    await this.send({
      to: opts.to,
      subject: `Confirm your ${BRAND.productName} email`,
      template: 'email-verification',
      variables: {
        ...this.brand(),
        recipientName: opts.name,
        tenantName: opts.tenantName,
        verifyUrl: url,
      },
    });
  }

  async sendPasswordResetEmail(opts: { to: string; name: string; token: string }): Promise<void> {
    const url = this.urlFor('/reset-password', { token: opts.token });
    await this.send({
      to: opts.to,
      subject: `Reset your ${BRAND.productName} password`,
      template: 'password-reset',
      variables: {
        ...this.brand(),
        recipientName: opts.name,
        resetUrl: url,
      },
    });
  }

  async sendPasswordChangedNotification(opts: { to: string; name: string }): Promise<void> {
    await this.send({
      to: opts.to,
      subject: `Your ${BRAND.productName} password was changed`,
      template: 'password-changed-notification',
      variables: {
        ...this.brand(),
        recipientName: opts.name,
      },
    });
  }

  async sendWelcomeEmail(opts: {
    to: string;
    name: string;
    tenantName: string;
  }): Promise<void> {
    await this.send({
      to: opts.to,
      subject: `Welcome to ${BRAND.productName}`,
      template: 'welcome',
      variables: {
        ...this.brand(),
        recipientName: opts.name,
        tenantName: opts.tenantName,
        appUrl: this.config.webPublicUrl,
      },
    });
  }

  // ----- Session 10: billing emails -----

  async sendInvoiceIssuedEmail(opts: {
    to: string;
    recipientName: string;
    tenantName: string;
    invoiceNumber: string;
    totalFormatted: string;
    balanceFormatted: string;
    dueDate: string | null;
    invoiceUrl: string | null;
  }): Promise<void> {
    await this.send({
      to: opts.to,
      subject: `Invoice ${opts.invoiceNumber} from ${opts.tenantName}`,
      template: 'invoice-issued',
      variables: {
        ...this.brand(),
        recipientName: opts.recipientName,
        tenantName: opts.tenantName,
        invoiceNumber: opts.invoiceNumber,
        totalFormatted: opts.totalFormatted,
        balanceFormatted: opts.balanceFormatted,
        dueDate: opts.dueDate,
        invoiceUrl: opts.invoiceUrl,
      },
    });
  }

  async sendInvoiceOverdueEmail(opts: {
    to: string;
    recipientName: string;
    tenantName: string;
    invoiceNumber: string;
    balanceFormatted: string;
    dueDate: string | null;
    invoiceUrl: string | null;
  }): Promise<void> {
    await this.send({
      to: opts.to,
      subject: `Past due: invoice ${opts.invoiceNumber}`,
      template: 'invoice-overdue',
      variables: {
        ...this.brand(),
        recipientName: opts.recipientName,
        tenantName: opts.tenantName,
        invoiceNumber: opts.invoiceNumber,
        balanceFormatted: opts.balanceFormatted,
        dueDate: opts.dueDate,
        invoiceUrl: opts.invoiceUrl,
      },
    });
  }

  async sendStatementGeneratedEmail(opts: {
    to: string;
    recipientName: string;
    tenantName: string;
    asOfDate: string;
    invoiceCount: number;
    totalFormatted: string;
  }): Promise<void> {
    await this.send({
      to: opts.to,
      subject: `Statement of account — ${opts.tenantName}`,
      template: 'statement-generated',
      variables: {
        ...this.brand(),
        recipientName: opts.recipientName,
        tenantName: opts.tenantName,
        asOfDate: opts.asOfDate,
        invoiceCount: opts.invoiceCount,
        totalFormatted: opts.totalFormatted,
      },
    });
  }

  async sendCreditMemoIssuedEmail(opts: {
    to: string;
    recipientName: string;
    tenantName: string;
    memoNumber: string;
    invoiceNumber: string;
    amountFormatted: string;
    reason: string;
    appliedToText: string;
  }): Promise<void> {
    await this.send({
      to: opts.to,
      subject: `Credit memo ${opts.memoNumber}`,
      template: 'credit-memo-issued',
      variables: {
        ...this.brand(),
        recipientName: opts.recipientName,
        tenantName: opts.tenantName,
        memoNumber: opts.memoNumber,
        invoiceNumber: opts.invoiceNumber,
        amountFormatted: opts.amountFormatted,
        reason: opts.reason,
        appliedToText: opts.appliedToText,
      },
    });
  }

  /**
   * Used by the diagnostic endpoint (POST /admin/email/test). Renders the
   * email-verification template against canned variables and returns the
   * full provider response so the operator can see SendGrid's status / body
   * directly. Failures are returned, NOT thrown.
   */
  async sendTestEmail(to: string): Promise<SendDiagnostic> {
    const subject = `${BRAND.productName} — diagnostic test send`;
    const { html, text } = this.renderer.render('email-verification', {
      ...this.brand(),
      recipientName: 'Diagnostic',
      tenantName: 'Diagnostic',
      verifyUrl: `${this.config.webPublicUrl}/verify-email?token=diagnostic`,
    });
    return this.attemptSend({ to, subject, html, text, template: 'diagnostic' });
  }

  private async send(args: SendArgs): Promise<void> {
    const { html, text } = this.renderer.render(args.template, args.variables);
    const result = await this.attemptSend({
      to: args.to,
      subject: args.subject,
      html,
      text,
      template: args.template,
    });
    if (!result.ok) {
      // We log here and re-throw. Auth-flow callers wrap this in
      // .catch(() => undefined) so transient failures don't break signup,
      // but we want the rejection to be visible in any context that does
      // care (BillingDeliveryService, /admin/email/test, etc.).
      const err = new Error(
        `email send failed template=${args.template} provider=${result.provider} status=${result.statusCode ?? 'n/a'} attempts=${result.attempts} reason=${result.errorMessage ?? 'unknown'}`,
      );
      throw err;
    }
  }

  private async attemptSend(args: {
    to: string;
    subject: string;
    html: string;
    text: string;
    template: string;
  }): Promise<SendDiagnostic> {
    const provider: 'sendgrid' | 'smtp' = this.config.email.sendgridConfigured
      ? 'sendgrid'
      : 'smtp';
    const from = this.config.email.from;

    this.log.log({
      msg: 'email send invoked',
      provider,
      template: args.template,
      to: args.to,
      from,
      subject: args.subject,
    });

    let lastErr: ResponseError | Error | null = null;
    let lastStatus: number | undefined;
    let lastBody: unknown;
    let lastMessageId: string | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        if (provider === 'sendgrid') {
          this.ensureSendGridInitialized();
          const msg: MailDataRequired = {
            to: args.to,
            from,
            subject: args.subject,
            html: args.html,
            text: args.text,
          };
          const [response] = await sgMail.send(msg);
          const messageId =
            (response.headers['x-message-id'] as string | undefined) ??
            (response.headers['X-Message-Id'] as string | undefined);
          this.log.log({
            msg: 'email send ok',
            provider,
            template: args.template,
            to: args.to,
            attempt,
            statusCode: response.statusCode,
            messageId,
          });
          return {
            ok: true,
            provider,
            attempts: attempt,
            statusCode: response.statusCode,
            messageId,
          };
        }
        // SMTP fallback
        const transporter = this.ensureSmtpTransporter();
        const info = await transporter.sendMail({
          from,
          to: args.to,
          subject: args.subject,
          html: args.html,
          text: args.text,
        });
        this.log.log({
          msg: 'email send ok',
          provider,
          template: args.template,
          to: args.to,
          attempt,
          messageId: info.messageId,
        });
        return {
          ok: true,
          provider,
          attempts: attempt,
          messageId: info.messageId,
        };
      } catch (err) {
        const responseErr = err as ResponseError;
        const status = responseErr?.code;
        lastStatus = typeof status === 'number' ? status : undefined;
        lastBody = responseErr?.response?.body ?? null;
        lastErr = responseErr instanceof Error ? responseErr : new Error(String(responseErr));
        this.log.error({
          msg: 'email send error',
          provider,
          template: args.template,
          to: args.to,
          attempt,
          statusCode: lastStatus,
          errorMessage: lastErr.message,
          errorBody: lastBody,
        });
        const retriable = typeof lastStatus === 'number' && lastStatus >= 500;
        if (!retriable || attempt === MAX_ATTEMPTS) break;
        const delay = BACKOFF_BASE_MS * 2 ** (attempt - 1);
        await sleep(delay);
      }
    }

    return {
      ok: false,
      provider,
      attempts: MAX_ATTEMPTS,
      statusCode: lastStatus,
      messageId: lastMessageId,
      errorMessage: lastErr?.message,
      errorBody: lastBody,
    };
  }

  private ensureSendGridInitialized(): void {
    if (this.sgInitialized) return;
    const apiKey = this.config.email.sendgridApiKey;
    if (!apiKey) {
      throw new Error(
        'SENDGRID_API_KEY is empty at first send — ensureSendGridInitialized should not have been called',
      );
    }
    sgMail.setApiKey(apiKey);
    this.sgInitialized = true;
    this.log.log({ msg: 'sendgrid client initialized', from: this.config.email.from });
  }

  private ensureSmtpTransporter(): Transporter {
    if (this.smtpTransporter) return this.smtpTransporter;
    const { host, port, user, password, secure } = this.config.smtp;
    this.smtpTransporter = nodemailer.createTransport({
      host,
      port,
      secure,
      ...(user && password ? { auth: { user, pass: password } } : {}),
    });
    this.log.log({ msg: 'smtp transporter initialized', host, port, secure });
    return this.smtpTransporter;
  }

  private urlFor(path: string, query: Record<string, string>): string {
    const url = new URL(path, this.config.webPublicUrl);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return url.toString();
  }

  private brand(): BrandVars {
    return BRAND;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
