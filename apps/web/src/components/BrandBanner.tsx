interface BrandBannerProps {
  /** `header`: compact, for the app bar. `hero`: large, for the welcome screen. */
  size?: 'header' | 'hero';
  className?: string;
}

/** The fixed bilingual logotype — unlike `t('appName')`, this doesn't switch with locale. */
export function BrandBanner({ size = 'header', className }: BrandBannerProps) {
  return (
    <div className={`brand-banner brand-banner--${size} ${className ?? ''}`}>
      <img className="brand-banner-icon" src="/icon.svg" width={64} height={64} alt="" />
      <div className="brand-banner-text">
        <span className="brand-banner-zh">台鐵任務</span>
        <span className="brand-banner-en">TRMISSION</span>
      </div>
    </div>
  );
}
