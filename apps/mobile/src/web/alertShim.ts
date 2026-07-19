// react-native-web ships Alert.alert as a silent no-op, which would swallow every
// confirm-gated flow in the harness (leave game, delete account, the tutorial nudge…).
// Map it onto the browser's native dialogs, which Playwright drives deterministically
// (page.on('dialog') / browser_handle_dialog):
// - 0–1 buttons → window.alert, then the single button's onPress.
// - 2+ buttons → window.confirm: OK runs the LAST non-cancel button (the affirmative one by
//   RN convention), Cancel runs the `style: 'cancel'` button (usually a no-op).
// Evaluated only from index.ts's web branch — never on native.
import { Alert, type AlertButton } from 'react-native';

Alert.alert = (title, message, buttons) => {
  const text = message ? `${title}\n\n${message}` : title;
  const list: AlertButton[] = buttons ?? [];
  if (list.length <= 1) {
    window.alert(text);
    list[0]?.onPress?.();
    return;
  }
  const affirmative = [...list].reverse().find((b) => b.style !== 'cancel') ?? list[list.length - 1];
  const cancel = list.find((b) => b.style === 'cancel');
  if (window.confirm(text)) affirmative?.onPress?.();
  else cancel?.onPress?.();
};
