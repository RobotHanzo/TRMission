// Canonical catalog of UGC report categories (Apple 1.2 / Play UGC compliance).
// The wire carries only the id; every client resolves `report.category_<ID>` through
// its own i18n. Defined once here so server validation, the dashboard, the web app,
// and the mobile app can never drift.
export const REPORT_CATEGORIES = [
  'HARASSMENT',
  'HATE_SPEECH',
  'CHEATING',
  'SPAM',
  'INAPPROPRIATE_NAME',
  'INAPPROPRIATE_CONTENT',
  'OTHER',
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const isReportCategory = (v: string): v is ReportCategory =>
  (REPORT_CATEGORIES as readonly string[]).includes(v);
