import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import i18n from '../i18n';
import { useDocumentMeta } from './useDocumentMeta';
import { useUi } from '../store/ui';

function Probe() {
  useDocumentMeta();
  return null;
}

const robotsMeta = () => document.head.querySelector('meta[name="robots"]');
const canonical = () => document.head.querySelector('link[rel="canonical"]');
const jsonLd = () => document.getElementById('trm-jsonld');

describe('useDocumentMeta', () => {
  beforeEach(async () => {
    // The store's locale is synced onto i18next by App, not by the hook — do it here.
    await i18n.changeLanguage('zh-Hant');
    useUi.setState({ view: 'home', roomCode: null, locale: 'zh-Hant' });
    document.head.querySelector('meta[name="robots"]')?.remove();
    document.head.querySelector('link[rel="canonical"]')?.remove();
    document.getElementById('trm-jsonld')?.remove();
  });

  it('indexable pages get a title, canonical, no robots meta — home also gets JSON-LD', () => {
    render(<Probe />);
    expect(document.title).toContain('台鐵任務');
    expect(canonical()?.getAttribute('href')).toBe(`${window.location.origin}/`);
    expect(robotsMeta()).toBeNull();
    const ld = JSON.parse(jsonLd()?.textContent ?? '{}');
    expect(ld['@type']).toBe('VideoGame');
    expect(ld.url).toBe(`${window.location.origin}/`);
  });

  it('the tutorial page canonicalises to /tutorial and drops the home JSON-LD', () => {
    const { rerender } = render(<Probe />);
    expect(jsonLd()).not.toBeNull();
    useUi.setState({ view: 'tutorial' });
    rerender(<Probe />);
    expect(document.title).toContain('新手教學');
    expect(canonical()?.getAttribute('href')).toBe(`${window.location.origin}/tutorial`);
    expect(robotsMeta()).toBeNull();
    expect(jsonLd()).toBeNull();
  });

  it('ephemeral capability URLs (rooms) are noindex with the code in the title', () => {
    useUi.setState({ view: 'room', roomCode: 'ABCD' });
    render(<Probe />);
    expect(document.title).toContain('ABCD');
    expect(robotsMeta()?.getAttribute('content')).toBe('noindex');
    expect(canonical()).toBeNull();
  });

  it('titles follow the active locale', async () => {
    await i18n.changeLanguage('en');
    useUi.setState({ view: 'login', locale: 'en' });
    render(<Probe />);
    expect(document.title).toContain('Sign in');
  });
});
