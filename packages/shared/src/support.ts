// Canonical catalog of support-request categories (the App Store / Play "support URL" form,
// issue #80). The wire carries only the id; the web form resolves `support.category_<ID>`
// through its own i18n and the Discord card shows the id itself. Defined once here so server
// validation and the clients can never drift — same contract as `reports.ts`.
export const SUPPORT_CATEGORIES = ['BUG', 'ACCOUNT', 'GAMEPLAY', 'FEEDBACK', 'OTHER'] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const isSupportCategory = (v: string): v is SupportCategory =>
  (SUPPORT_CATEGORIES as readonly string[]).includes(v);
