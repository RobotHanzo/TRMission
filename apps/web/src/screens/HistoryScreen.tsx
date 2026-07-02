import { useTranslation } from 'react-i18next';

export function HistoryScreen() {
  const { t } = useTranslation();
  return (
    <div className="stack">
      <div className="card">
        <h2>{t('history.title')}</h2>
      </div>
    </div>
  );
}
