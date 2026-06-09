/**
 * Getting Started article bodies.
 *
 * Each export is a React component rendered inside the article surface
 * wrapper. Articles follow the standard 5-section template:
 *   1. Purpose (the "Why")
 *   2. Prerequisites
 *   3. Step-by-Step Guide
 *   4. Common Mistakes & Troubleshooting
 *   5. Related Documents
 */
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

// =====================================================================
// Shared building blocks for consistent article presentation
// =====================================================================

function H2({ children }: { children: ReactNode }): JSX.Element {
  return (
    <h2 className="font-condensed mt-8 text-2xl font-extrabold uppercase tracking-tight text-text-primary-on-dark">
      {children}
    </h2>
  );
}

function H3({ children }: { children: ReactNode }): JSX.Element {
  return <h3 className="mt-6 text-base font-semibold text-text-primary-on-dark">{children}</h3>;
}

function P({ children }: { children: ReactNode }): JSX.Element {
  return <p className="mt-3 text-sm leading-7 text-text-primary-on-dark/90">{children}</p>;
}

function Em({ children }: { children: ReactNode }): JSX.Element {
  return <strong className="font-semibold text-text-primary-on-dark">{children}</strong>;
}

function Code({ children }: { children: ReactNode }): JSX.Element {
  return (
    <code className="rounded bg-bg-surface-elevated px-1 py-0.5 font-mono text-[12px] text-brand-primary">
      {children}
    </code>
  );
}

function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'tip';
  title: string;
  children: ReactNode;
}): JSX.Element {
  const accent =
    tone === 'warning'
      ? 'border-status-warning/40 bg-status-warning/10'
      : tone === 'tip'
        ? 'border-ok/40 bg-ok/10'
        : 'border-info/40 bg-info/10';
  return (
    <div className={`mt-4 rounded-[10px] border ${accent} p-4`}>
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary-on-dark">
        {title}
      </p>
      <div className="mt-1 text-sm leading-7 text-text-primary-on-dark/90">{children}</div>
    </div>
  );
}

function OrderedList({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ol className="mt-3 list-decimal space-y-2 pl-6 text-sm leading-7 text-text-primary-on-dark/90">
      {children}
    </ol>
  );
}

function UnorderedList({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ul className="mt-3 list-disc space-y-2 pl-6 text-sm leading-7 text-text-primary-on-dark/90">
      {children}
    </ul>
  );
}

function RelatedDoc({ href, title }: { href: string; title: string }): JSX.Element {
  return (
    <Link href={href} className="text-brand-primary hover:underline">
      {title}
    </Link>
  );
}

// =====================================================================
// Article 1 — System Requirements & Browser Setup
// =====================================================================

export function SystemRequirementsArticle(): JSX.Element {
  return (
    <div>
      <H2>1. Purpose</H2>
      <P>
        US Tow Dispatch is a modern, cloud-based application. Unlike legacy software that requires
        installation or dedicated hardware, you can run your entire towing operation from any device
        with an internet connection. This guide outlines the recommended hardware and browser
        settings to ensure the platform runs smoothly, especially for location-dependent features
        like the live dispatch board.
      </P>

      <H2>2. Prerequisites</H2>
      <UnorderedList>
        <li>A stable internet connection (broadband for the office, 4G/LTE/5G for drivers).</li>
        <li>Your login credentials (email and password, or driver PIN).</li>
      </UnorderedList>

      <H2>3. Step-by-Step Guide</H2>

      <H3>Recommended Hardware</H3>
      <P>
        The platform is designed to be lightweight, but dispatchers handling high call volumes will
        benefit from adequate screen real estate.
      </P>
      <UnorderedList>
        <li>
          <Em>Dispatchers and office staff:</Em> any desktop or laptop manufactured in the last five
          years. A dual-monitor setup is highly recommended (Monitor 1: Live Dispatch Board; Monitor
          2: Call Intake or Billing).
        </li>
        <li>
          <Em>Drivers:</Em> any smartphone or tablet running iOS or Android, manufactured in the
          last four years. A dashboard or windshield mount is required for safety.
        </li>
      </UnorderedList>

      <H3>Supported Browsers</H3>
      <P>
        For the best experience, we strongly recommend the latest version of <Em>Google Chrome</Em>{' '}
        or <Em>Apple Safari</Em>.
      </P>
      <UnorderedList>
        <li>
          <Em>Google Chrome</Em> — recommended for Windows, Mac, and Android. Provides the most
          consistent performance for our real-time map features.
        </li>
        <li>
          <Em>Apple Safari</Em> — recommended for iPhone and iPad. Handles location permissions
          seamlessly on Apple devices.
        </li>
        <li>
          <Em>Microsoft Edge / Mozilla Firefox</Em> — supported, but you may experience minor visual
          differences.
        </li>
      </UnorderedList>
      <Callout tone="warning" title="Not supported">
        Internet Explorer is not supported. Please use one of the modern browsers above.
      </Callout>

      <H3>Enabling Location Services (Crucial for Drivers)</H3>
      <P>
        For the dispatch board to track trucks accurately and calculate ETAs, the browser must be
        allowed to access the device's location.
      </P>
      <H3>On an iPhone or iPad (Safari)</H3>
      <OrderedList>
        <li>
          Open the <Em>Settings</Em> app on your device.
        </li>
        <li>
          Scroll down and tap <Em>Privacy &amp; Security</Em>, then <Em>Location Services</Em>.
        </li>
        <li>
          Ensure Location Services is toggled <Em>On</Em>.
        </li>
        <li>
          Scroll down to <Em>Safari Websites</Em> and select <Em>While Using the App</Em>.
        </li>
      </OrderedList>
      <H3>On an Android Device (Chrome)</H3>
      <OrderedList>
        <li>
          Open the <Em>Settings</Em> app on your device.
        </li>
        <li>
          Tap <Em>Location</Em> and ensure it is turned <Em>On</Em>.
        </li>
        <li>
          Tap <Em>App permissions</Em> (or <Em>App access to location</Em>).
        </li>
        <li>
          Find <Em>Chrome</Em> in the list and select <Em>Allow only while using the app</Em>.
        </li>
      </OrderedList>
      <P>
        When you first log in to US Tow Dispatch, your browser will prompt:{' '}
        <Em>"app.ustowdispatch.cloud wants to use your device's location."</Em> You must tap{' '}
        <Em>Allow</Em>.
      </P>

      <H2>4. Common Mistakes &amp; Troubleshooting</H2>
      <H3>Driver location shows as "Unknown" on the dispatch board</H3>
      <P>
        The driver likely tapped <Em>Deny</Em> when the browser asked for location permission. Have
        the driver clear their browser settings for the site (or sign out and back in) to re-trigger
        the prompt, then tap <Em>Allow</Em>.
      </P>
      <H3>The site feels sluggish or unresponsive</H3>
      <P>
        Ensure the user is not running an ad-blocker or strict privacy extension that might be
        blocking the connection to our real-time map provider. Try the site in an <Em>Incognito</Em>{' '}
        or <Em>Private</Em> window to confirm whether an extension is the cause.
      </P>

      <H2>5. Related Documents</H2>
      <UnorderedList>
        <li>
          <RelatedDoc
            href="/help/getting-started/company-profile"
            title="Setting up your Company Profile"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/getting-started/inviting-users"
            title="Inviting Users and Setting Permissions"
          />
        </li>
      </UnorderedList>
    </div>
  );
}

// =====================================================================
// Article 2 — Setting up your Company Profile
// =====================================================================

export function CompanyProfileArticle(): JSX.Element {
  return (
    <div>
      <H2>1. Purpose</H2>
      <P>
        Your Company Profile is the operating address for everything US Tow Dispatch does on your
        behalf. The seventeen fields under <Em>Settings → Company</Em> control how invoices,
        statements, customer-facing tracking pages, and motor-club paperwork are branded and
        addressed. Filling this out correctly the first time prevents downstream confusion across
        every other surface in the platform.
      </P>

      <H2>2. Prerequisites</H2>
      <UnorderedList>
        <li>
          You must be signed in as the tenant <Em>Owner</Em> or <Em>Admin</Em>.
        </li>
        <li>
          Have your business legal name, DBA (if applicable), tax ID, and primary address ready.
        </li>
      </UnorderedList>

      <H2>3. Step-by-Step Guide</H2>
      <OrderedList>
        <li>
          Navigate to <Em>Settings → Company</Em> in the left sidebar.
        </li>
        <li>
          Fill in the <Em>Identity</Em> section: legal name, DBA, federal tax ID (EIN), and
          state/local registration numbers if your jurisdiction requires them on invoices.
        </li>
        <li>
          Fill in the <Em>Contact</Em> section: primary phone, dispatch phone, accounting email, and
          the customer-facing email customers will see on receipts.
        </li>
        <li>
          Fill in the <Em>Address</Em> section: your primary business address and your dispatch yard
          address (used by the rate engine to estimate enroute miles).
        </li>
        <li>
          Upload your <Em>Logo</Em> image. PNG with a transparent background works best. The logo
          appears on PDF invoices, statements, and the customer tracking page header.
        </li>
        <li>
          Set <Em>Brand Color</Em> hex codes (primary and accent). These drive the customer tracking
          page accents.
        </li>
        <li>
          Click <Em>Save Profile</Em>. A confirmation toast appears at the bottom of the screen.
        </li>
      </OrderedList>

      <Callout tone="tip" title="Why every field matters">
        Each field maps to a specific surface elsewhere in the platform. The legal name appears on
        invoices; the dispatch phone is what customers call after they receive a tracking-link SMS;
        the brand color is what colors the tracking page they see while their tow is in progress.
        Skipping fields leads to placeholder text appearing in front of customers.
      </Callout>

      <H2>4. Common Mistakes &amp; Troubleshooting</H2>
      <H3>Logo appears stretched or cut off on PDF invoices</H3>
      <P>
        Use a logo with a transparent background and a roughly 3:1 aspect ratio (e.g., 600 × 200
        pixels). Square logos work but appear small. Tall, narrow logos crop poorly on the PDF
        header.
      </P>
      <H3>The dispatch yard address is wrong on rate quotes</H3>
      <P>
        The rate engine uses the dispatch yard address to compute deadhead miles. If a job's enroute
        miles seem off, check that the dispatch yard address on the Company Profile matches the
        address you actually dispatch trucks from.
      </P>

      <H2>5. Related Documents</H2>
      <UnorderedList>
        <li>
          <RelatedDoc
            href="/help/getting-started/inviting-users"
            title="Inviting Users and Setting Permissions"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/getting-started/connect-stripe"
            title="Connecting your Stripe Account"
          />
        </li>
      </UnorderedList>
    </div>
  );
}

// =====================================================================
// Article 3 — Inviting Users and Setting Permissions
// =====================================================================

export function InvitingUsersArticle(): JSX.Element {
  return (
    <div>
      <H2>1. Purpose</H2>
      <P>
        US Tow Dispatch supports a flexible role-based permission model. The owner invites every
        teammate, assigns them a role, and the platform decides what each person can see and do
        based on that role. This guide walks through inviting your first teammates and choosing the
        right role for each.
      </P>

      <H2>2. Prerequisites</H2>
      <UnorderedList>
        <li>
          You must be signed in as the tenant <Em>Owner</Em> or <Em>Admin</Em>.
        </li>
        <li>You should have each teammate's email address and full name ready before you start.</li>
      </UnorderedList>

      <H2>3. Step-by-Step Guide</H2>
      <H3>Inviting a teammate</H3>
      <OrderedList>
        <li>
          Navigate to <Em>Settings → Users</Em> in the left sidebar.
        </li>
        <li>
          Click <Em>Invite User</Em> in the upper right.
        </li>
        <li>
          Enter the teammate's <Em>email</Em>, <Em>first name</Em>, and <Em>last name</Em>.
        </li>
        <li>
          Pick a <Em>Role</Em> (see role descriptions below).
        </li>
        <li>
          Click <Em>Send Invite</Em>. The teammate receives an email with a link to set their
          password and sign in.
        </li>
      </OrderedList>

      <H3>Choosing the right role</H3>
      <UnorderedList>
        <li>
          <Em>Owner</Em> — full control of the tenant including billing, integrations, and the
          ability to delete the account. Reserve this role for principals.
        </li>
        <li>
          <Em>Admin</Em> — full operational control short of deleting the tenant. Can invite and
          manage users, configure rate sheets, manage integrations.
        </li>
        <li>
          <Em>Manager</Em> — supervises dispatchers and drivers. Can override rates, approve tier
          activations, and run reports.
        </li>
        <li>
          <Em>Dispatcher</Em> — daily dispatch board operator. Can take calls, assign drivers, edit
          job details. Cannot edit rate sheets or invite users.
        </li>
        <li>
          <Em>Accounting</Em> — handles invoicing, A/R, and statement delivery. Cannot dispatch
          jobs.
        </li>
        <li>
          <Em>Driver</Em> — field operator. Sees only their assigned jobs and can capture evidence.
        </li>
        <li>
          <Em>Auditor</Em> — read-only role for external accountants and reviewers. No edit access
          anywhere.
        </li>
      </UnorderedList>

      <H3>Changing or removing a teammate's role</H3>
      <OrderedList>
        <li>
          Find the user in the <Em>Settings → Users</Em> table.
        </li>
        <li>
          Click the <Em>role dropdown</Em> in their row and pick the new role.
        </li>
        <li>
          To remove a teammate's access entirely, click <Em>Deactivate</Em>. They retain their
          history (jobs they dispatched are still attributed to them) but cannot sign in.
        </li>
      </OrderedList>

      <H2>4. Common Mistakes &amp; Troubleshooting</H2>
      <H3>The invitation email never arrived</H3>
      <P>
        Ask the teammate to check spam. The email comes from{' '}
        <Code>no-reply@ustowdispatch.cloud</Code>. If it is still missing, you can resend the invite
        from the user's row in the Users table.
      </P>
      <H3>I gave someone the wrong role</H3>
      <P>
        Role changes are instant. Change the role from the dropdown and the teammate's permissions
        update on their next page load.
      </P>

      <H2>5. Related Documents</H2>
      <UnorderedList>
        <li>
          <RelatedDoc
            href="/help/getting-started/connect-stripe"
            title="Connecting your Stripe Account"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/getting-started/connect-quickbooks"
            title="Connecting QuickBooks Online"
          />
        </li>
      </UnorderedList>
    </div>
  );
}

// =====================================================================
// Article 4 — Connecting your Stripe Account
// =====================================================================

export function ConnectStripeArticle(): JSX.Element {
  return (
    <div>
      <H2>1. Purpose</H2>
      <P>
        US Tow Dispatch uses Stripe to process credit card payments on your behalf — both at the
        scene (Stripe Terminal) and back-office hosted-checkout links sent with invoices. By
        connecting your own Stripe account, payments flow directly to your bank, not through us. We
        never hold your money.
      </P>

      <H2>2. Prerequisites</H2>
      <UnorderedList>
        <li>
          You must be signed in as the tenant <Em>Owner</Em>.
        </li>
        <li>
          A Stripe account is required. If you do not have one, you can create one free at{' '}
          <a className="text-brand-primary hover:underline" href="https://stripe.com">
            stripe.com
          </a>
          .
        </li>
        <li>
          Have your business EIN, your business legal name, and a primary banking deposit account
          handy. Stripe requires these to verify your business.
        </li>
      </UnorderedList>

      <H2>3. Step-by-Step Guide</H2>
      <OrderedList>
        <li>
          Navigate to <Em>Settings → Integrations</Em>.
        </li>
        <li>
          In the <Em>Payment Processing</Em> card, click <Em>Connect Stripe</Em>.
        </li>
        <li>
          You are redirected to Stripe's secure consent page. Sign in to your Stripe account, or
          create one. Complete Stripe's business-verification questions if prompted.
        </li>
        <li>
          When verification is complete, click <Em>Authorize</Em>. Stripe redirects you back to US
          Tow DISPATCH.
        </li>
        <li>
          The Payment Processing card now shows a green <Em>Connected</Em> badge. You're done.
        </li>
      </OrderedList>

      <Callout tone="info" title="What this enables">
        Once connected, you can take card payments at the scene through Stripe Terminal, send
        hosted-checkout payment links with every invoice, and reconcile paid invoices against
        Stripe's payouts to your bank automatically.
      </Callout>

      <H2>4. Common Mistakes &amp; Troubleshooting</H2>
      <H3>"Stripe rejected the connection" message</H3>
      <P>
        Stripe sometimes pauses high-risk industry accounts during verification. Towing is not on
        their high-risk list, but if you receive this message, contact Stripe support directly —
        they can review your account faster than we can. We do not get visibility into Stripe's
        verification reasoning.
      </P>
      <H3>Payouts are slower than expected</H3>
      <P>
        Stripe's standard payout schedule is 2 business days for established accounts. Newly
        verified accounts may have a 7-day rolling reserve. This is a Stripe policy, not a US Tow
        DISPATCH setting. Contact Stripe support to discuss accelerating your schedule.
      </P>

      <H2>5. Related Documents</H2>
      <UnorderedList>
        <li>
          <RelatedDoc
            href="/help/getting-started/connect-quickbooks"
            title="Connecting QuickBooks Online"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/billing-finance/card-payments"
            title="Processing Credit Cards in the Field vs. Office"
          />
        </li>
      </UnorderedList>
    </div>
  );
}

// =====================================================================
// Article 5 — Connecting QuickBooks Online
// =====================================================================

export function ConnectQuickbooksArticle(): JSX.Element {
  return (
    <div>
      <H2>1. Purpose</H2>
      <P>
        Connecting QuickBooks Online lets US Tow Dispatch push every closed invoice to your QBO
        ledger automatically. Your bookkeeper stops manually re-entering invoices, and your
        month-end close reconciles in minutes instead of hours. This is one of the highest-ROI
        integrations in the platform.
      </P>

      <H2>2. Prerequisites</H2>
      <UnorderedList>
        <li>
          You must be signed in as the tenant <Em>Owner</Em> or <Em>Admin</Em>.
        </li>
        <li>
          You must have an active QuickBooks Online subscription. QuickBooks Desktop is not
          supported by this integration.
        </li>
        <li>You must have administrative access in QBO to authorize a third-party app.</li>
      </UnorderedList>

      <H2>3. Step-by-Step Guide</H2>
      <OrderedList>
        <li>
          Navigate to <Em>Settings → Integrations</Em>.
        </li>
        <li>
          In the <Em>Accounting</Em> card, click <Em>Connect QuickBooks Online</Em>.
        </li>
        <li>You are redirected to Intuit's secure sign-in. Enter your QBO credentials.</li>
        <li>
          Review the permissions Intuit asks you to grant. Click <Em>Connect</Em>.
        </li>
        <li>
          You are returned to US Tow Dispatch. The Accounting card now shows a green{' '}
          <Em>Connected</Em> badge with the name of the QBO company file you connected.
        </li>
        <li>
          Configure your <Em>Customer Sync</Em> mapping: pick whether each US Tow Dispatch customer
          creates a new QBO customer (default), or maps to an existing QBO customer by email or name
          match.
        </li>
        <li>
          Configure <Em>Invoice Push</Em>: choose whether closed invoices push to QBO automatically
          (default) or only when an admin clicks <Em>Push to QBO</Em> on the invoice review screen.
        </li>
      </OrderedList>

      <Callout tone="tip" title="Best practice for first-time setup">
        Before connecting, ask your bookkeeper which QBO income account towing revenue should post
        to (commonly a "Service Revenue" or "Towing Income" account). The integration will prompt
        you to pick one during setup.
      </Callout>

      <H2>4. Common Mistakes &amp; Troubleshooting</H2>
      <H3>Invoices are pushing to the wrong income account</H3>
      <P>
        Re-open <Em>Settings → Integrations → Accounting</Em>, click <Em>Configure</Em>, and change
        the income-account mapping. New invoices use the new mapping; previously posted invoices
        need to be edited in QBO directly.
      </P>
      <H3>Customer sync created duplicate customers in QBO</H3>
      <P>
        This usually happens when the same customer signs up under different email addresses across
        systems. Use QBO's <Em>Merge Customers</Em> tool to consolidate them. Then update your
        customer-sync mapping in our integration settings to match by email so the duplication does
        not recur.
      </P>
      <H3>The connection went stale ("Reconnect QuickBooks" notice appears)</H3>
      <P>
        QBO refresh tokens expire periodically. Click <Em>Reconnect QuickBooks</Em> and complete the
        OAuth handshake again. Your prior settings (mappings, sync rules) are preserved.
      </P>

      <H2>5. Related Documents</H2>
      <UnorderedList>
        <li>
          <RelatedDoc
            href="/help/billing-finance/generating-invoices"
            title="Generating and Sending Invoices"
          />
        </li>
        <li>
          <RelatedDoc
            href="/help/getting-started/connect-stripe"
            title="Connecting your Stripe Account"
          />
        </li>
      </UnorderedList>
    </div>
  );
}
