/**
 * EmailService is the only place we talk to SMTP. AuthService and any future
 * notification path go through one of the typed sender methods so:
 *   - the from-address, brand variables, and template name live in one file
 *   - failures land in a single try/catch with a single log line
 *   - we can swap the transport (mailhog → SES → Postmark) by changing one
 *     factory rather than dozens of call sites
 *
 * Errors do NOT abort the auth flow. A failed verification email leaves the
 * user signed up; we surface "resend verification" so they can retry.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { ConfigService } from '../../config/config.service.js';
import { TemplateRenderer } from './template-renderer.service.js';

const BRAND = {
  productName: 'TowCommand Pro',
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

@Injectable()
export class EmailService implements OnModuleInit {
  private transporter!: Transporter;

  constructor(
    private readonly config: ConfigService,
    private readonly renderer: TemplateRenderer,
  ) {}

  onModuleInit(): void {
    const { host, port, user, password, secure } = this.config.smtp;
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      ...(user && password ? { auth: { user, pass: password } } : {}),
    });
  }

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

  // ----- Session 14: scheduled report delivery -----

  async sendScheduledReportEmail(opts: {
    to: string;
    reportName: string;
    downloadUrl: string;
    fileName: string;
    sizeBytes: number;
    expiresAt: string;
  }): Promise<void> {
    await this.send({
      to: opts.to,
      subject: `[${BRAND.productName}] ${opts.reportName} — scheduled report`,
      template: 'scheduled-report',
      variables: {
        ...this.brand(),
        reportName: opts.reportName,
        downloadUrl: opts.downloadUrl,
        fileName: opts.fileName,
        sizeBytes: opts.sizeBytes,
        expiresAt: opts.expiresAt,
      },
    });
  }

  private async send(args: SendArgs): Promise<void> {
    const { html, text } = this.renderer.render(args.template, args.variables);
    try {
      await this.transporter.sendMail({
        from: this.config.smtp.from,
        to: args.to,
        subject: args.subject,
        html,
        text,
      });
    } catch (err) {
      // Logging the actual error is the controller's job (it has the request
      // context). We swallow here so a transient SMTP fault doesn't break the
      // signup or password-reset flow that triggered the send.
      const reason = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[email] send failed template=${args.template} to=${args.to} reason=${reason}\n`,
      );
    }
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
