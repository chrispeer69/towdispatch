/**
 * /billing/aging/reports — Five canned A/R report templates with Excel
 * + PDF export. Build 5 (Part 2).
 *
 * The page itself is a server component that ships the client island
 * with no initial report data — the operator picks a template and
 * filters, then "Run Report" hits the BFF to materialize the JSON or
 * trigger a binary download.
 */
import { ArReportsClient } from './ar-reports-client';

export const metadata = { title: 'A/R reports — US Tow DISPATCH' };

export default function ArReportsPage(): JSX.Element {
  return <ArReportsClient />;
}
