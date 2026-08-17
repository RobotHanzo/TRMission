import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, RefreshCw, WifiOff } from 'lucide-react';
import { useUi, type View } from '../store/ui';
import { useSession } from '../store/session';
import { BrandBanner } from './BrandBanner';
import { AppStoreBadge } from './AppStoreBadge';
import { detectMobilePlatform, isAppPromptDismissed, dismissAppPrompt } from '../lib/mobileApp';
import { track } from '../lib/analytics';

/** Views the sheet may interrupt: the three surfaces an arrival actually lands on. Everywhere else
 *  it stays out of the way — a game/tutorial/replay/editor is immersive, and the legal, support and
 *  account-deletion pages are the last place in the app to advertise anything. */
const ARRIVAL_VIEWS: ReadonlySet<View> = new Set<View>(['home', 'login', 'room']);

/** How long after mount the sheet may appear. It buys two things: the page paints (and a shared
 *  room link starts resolving) before anything covers it, and `App`'s one-shot `syncFromUrl` has
 *  adopted the URL's view — without it a cold load of `/tutorial` would flash the sheet over the
 *  default `home` view for a frame before that effect runs. */
const SETTLE_MS = 700;

const POINTS = [
  { key: 'turnPush', Icon: Bell },
  { key: 'offline', Icon: WifiOff },
  { key: 'synced', Icon: RefreshCw },
] as const;

/** "Get the app" sheet for mobile browsers (issue #106) — an offer, never a gate: the web app stays
 *  fully playable behind it, dismissing takes one tap (or Escape, or the backdrop) and is
 *  remembered per device. Only shown where there is a public store listing to send the visitor to
 *  (`../lib/mobileApp.ts`), so a desktop browser never renders it. */
export function MobileAppPrompt() {
  const { t } = useTranslation();
  const view = useUi((s) => s.view);
  const booting = useSession((s) => s.booting);
  // The UA can't change within a tab, and the dismissal is only written by this component.
  const [platform] = useState(detectMobilePlatform);
  const [dismissed, setDismissed] = useState(isAppPromptDismissed);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!platform || dismissed) return; // never arm the timer for the desktop/dismissed case
    const id = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(id);
  }, [platform, dismissed]);

  const open = !!platform && !dismissed && !booting && settled && ARRIVAL_VIEWS.has(view);

  /** Closes for good. The store link uses this too: a visitor who left for the App Store has
   *  answered the question, so the sheet must not be waiting when they come back to the tab. */
  const close = useCallback(() => {
    dismissAppPrompt();
    setDismissed(true);
  }, []);
  const declineAndClose = useCallback(() => {
    track('app_prompt_dismiss', {});
    close();
  }, [close]);

  // One impression per page load: `open` can also fall to false on its own (the room's game
  // starts, so the view leaves the allowlist), and the sheet coming back later is the same offer.
  const impression = useRef(false);
  useEffect(() => {
    if (!open || !platform || impression.current) return;
    impression.current = true;
    track('app_prompt_shown', { platform });
  }, [open, platform]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') declineAndClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, declineAndClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop app-prompt-backdrop" onClick={declineAndClose}>
      <div
        className="modal app-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-prompt-title"
        onClick={(e) => e.stopPropagation()}
      >
        <BrandBanner size="header" className="app-prompt-brand" />
        <h3 id="app-prompt-title" className="app-prompt-title">
          {t('appPrompt.title')}
        </h3>
        <p className="app-prompt-lede">{t('appPrompt.lede')}</p>
        <ul className="app-prompt-points">
          {POINTS.map(({ key, Icon }) => (
            <li key={key}>
              <Icon size={16} aria-hidden />
              {t(`appPrompt.${key}`)}
            </li>
          ))}
        </ul>
        <AppStoreBadge source="mobile_prompt" className="app-prompt-badge" onNavigate={close} />
        <button type="button" className="link app-prompt-continue" onClick={declineAndClose}>
          {t('appPrompt.continueWeb')}
        </button>
      </div>
    </div>
  );
}
