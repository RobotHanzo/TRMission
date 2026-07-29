// Replay sharing: any seated player of the game may flip the replay between private
// (participants only) and view-by-link (anyone holding the URL); everyone gets a
// copy-link shortcut. Sits in the rail's footer, in the same pill family as the
// perspective switcher but at a quieter weight — this decides who else can watch,
// so it should never compete with the control you actually came here to use.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Link2, Lock } from 'lucide-react';
import { api, type ReplayVisibility } from '../../net/rest';
import { track } from '../../lib/analytics';

export function ReplayShare({
  gameId,
  visibility: initial,
  canConfigure,
}: {
  gameId: string;
  visibility: ReplayVisibility;
  canConfigure: boolean;
}) {
  const { t } = useTranslation();
  const [visibility, setVisibility] = useState<ReplayVisibility>(initial);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const change = (next: ReplayVisibility): void => {
    if (next === visibility) return;
    const prev = visibility;
    setFailed(false);
    setVisibility(next); // optimistic — the PATCH is a single flag flip
    track('replay_share_change', { visibility: next });
    api.setReplayVisibility(gameId, next).catch(() => {
      setVisibility(prev);
      setFailed(true);
    });
  };

  const copy = (): void => {
    void navigator.clipboard?.writeText(`${window.location.origin}/replay/${gameId}`).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="replay-share">
      <div className="perspective-label">{t('history.share')}</div>
      <div className="perspective-pills">
        {canConfigure && (
          <>
            <button
              className={'perspective-pill' + (visibility === 'private' ? ' is-active' : '')}
              onClick={() => change('private')}
              title={t('history.visibilityHintPrivate')}
            >
              <Lock size={13} aria-hidden /> {t('history.visibilityPrivate')}
            </button>
            <button
              className={'perspective-pill' + (visibility === 'link' ? ' is-active' : '')}
              onClick={() => change('link')}
              title={t('history.visibilityHintLink')}
            >
              <Link2 size={13} aria-hidden /> {t('history.visibilityLink')}
            </button>
          </>
        )}
        <button
          className={'perspective-pill perspective-pill--copy' + (copied ? ' is-copied' : '')}
          onClick={copy}
        >
          {copied ? <Check size={13} aria-hidden /> : <Link2 size={13} aria-hidden />}
          {copied ? t('history.linkCopied') : t('history.copyLink')}
        </button>
      </div>
      {failed && <p className="error">{t('history.visibilityFailed')}</p>}
    </div>
  );
}
