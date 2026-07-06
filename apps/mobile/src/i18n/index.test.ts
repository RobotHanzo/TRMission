import i18n from './index';

describe('i18n bootstrap', () => {
  it('defaults to zh-Hant and can switch to en', async () => {
    expect(i18n.t('home.title')).toBe('台鐵任務');
    await i18n.changeLanguage('en');
    expect(i18n.t('home.title')).toBe('TRMission');
    await i18n.changeLanguage('zh-Hant');
  });

  it('falls back to en for a locale with no resources', async () => {
    await i18n.changeLanguage('fr');
    expect(i18n.t('home.title')).toBe('TRMission');
    await i18n.changeLanguage('zh-Hant');
  });
});
