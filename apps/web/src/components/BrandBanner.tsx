interface BrandBannerProps {
  /** `header`: compact, for the app bar. `hero`: large, for the welcome/login screens. */
  size?: 'header' | 'hero';
  /** `h1` where the logotype IS the page heading (the login card) — the inner markup stays
   *  phrasing content so that's valid. Everywhere else it's decoration, so a plain `div`. */
  as?: 'div' | 'h1';
  className?: string;
}

/** The fixed bilingual logotype — unlike `t('appName')`, this doesn't switch with locale. */
export function BrandBanner({ size = 'header', as: Tag = 'div', className }: BrandBannerProps) {
  return (
    <Tag className={`brand-banner brand-banner--${size} ${className ?? ''}`}>
      <img className="brand-banner-icon" src="/icon.svg" width={64} height={64} alt="" />
      <span className="brand-banner-text">
        <span className="brand-banner-zh">台鐵任務</span>
        <span className="brand-banner-en">TRMISSION</span>
      </span>
    </Tag>
  );
}
