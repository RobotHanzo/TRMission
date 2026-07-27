import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../store/toast';

/** How long the button holds its "copied" tick before returning to the copy glyph. */
const FLASH_MS = 1400;

/** The async clipboard API is unavailable on a non-secure origin (a LAN dev host), so fall
 *  back to the legacy selection copy rather than failing silently there. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  const ta = document.createElement('textarea');
  try {
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}

interface CopyButtonProps {
  /** The FULL value that lands on the clipboard — never the shortened display text. */
  value: string;
  /** Names the value for assistive tech, e.g. "ID" ⇒ "Copy ID". */
  label?: string | undefined;
}

/** The copy affordance every id/email/code in the dashboard carries. */
export function CopyButton({ value, label }: CopyButtonProps) {
  const { t } = useTranslation();
  const pushToast = useToast((s) => s.push);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    // Table rows and account cards are click targets themselves — copying must not also open them.
    e.stopPropagation();
    e.preventDefault();
    void writeClipboard(value).then((ok) => {
      if (!ok) {
        pushToast('error', t('common.copyFailed'));
        return;
      }
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), FLASH_MS);
    });
  };

  const name = label ? t('common.copyOf', { label }) : t('common.copy');
  return (
    <button
      type="button"
      className={`oc-copy-btn${copied ? ' copied' : ''}`}
      onClick={onClick}
      title={name}
      aria-label={copied ? t('common.copied') : name}
    >
      {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
    </button>
  );
}

interface CopyableProps extends CopyButtonProps {
  /** What to render instead of the raw value (typically `shortId(value)`). */
  display?: ReactNode;
  /** Ids and codes are mono by default; pass false for prose-ish values. */
  mono?: boolean;
  muted?: boolean;
  className?: string;
}

/** A value plus its copy button. The full `value` is copied and shown on hover even when
 *  `display` shortens it. Renders an em dash placeholder for an absent value. */
export function Copyable({
  value,
  label,
  display,
  mono = true,
  muted = false,
  className,
}: CopyableProps) {
  if (!value) return <span className="oc-muted">—</span>;
  const cls = ['oc-copyable', mono && 'oc-mono', muted && 'oc-muted', className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls}>
      <span className="oc-copy-text" title={value}>
        {display ?? value}
      </span>
      <CopyButton value={value} label={label} />
    </span>
  );
}
