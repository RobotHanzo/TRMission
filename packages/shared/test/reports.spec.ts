import { describe, it, expect } from 'vitest';
import { REPORT_CATEGORIES, isReportCategory } from '../src/reports';
import { ROLE_PERMISSIONS } from '../src/dashboard';

describe('report categories', () => {
  it('has exactly the 7 curated categories, in order', () => {
    expect(REPORT_CATEGORIES).toEqual([
      'HARASSMENT',
      'HATE_SPEECH',
      'CHEATING',
      'SPAM',
      'INAPPROPRIATE_NAME',
      'INAPPROPRIATE_CONTENT',
      'OTHER',
    ]);
  });

  it('isReportCategory accepts every catalog id and rejects anything else', () => {
    for (const c of REPORT_CATEGORIES) expect(isReportCategory(c)).toBe(true);
    expect(isReportCategory('NOT_A_CATEGORY')).toBe(false);
    expect(isReportCategory('')).toBe(false);
  });
});

describe('reports dashboard permissions', () => {
  it('moderator (and up) can read and resolve reports; viewer cannot', () => {
    expect(ROLE_PERMISSIONS.moderator).toContain('reports.read');
    expect(ROLE_PERMISSIONS.moderator).toContain('reports.resolve');
    expect(ROLE_PERMISSIONS.admin).toContain('reports.resolve');
    expect(ROLE_PERMISSIONS.viewer).not.toContain('reports.read');
  });
});
