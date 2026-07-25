import { useCallback, useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import HomeTabs from './HomeTabs';
import type { RootStackParamList } from './navigation';
import { getTutorialCompletion } from './features/tutorial/progress';
import { markWelcomeSeen, shouldShowWelcome, WelcomeScreen } from './screens/WelcomeScreen';
import { useSession } from './store/session';
import { Screen } from './theme/chrome';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

/**
 * The `Home` root-stack screen: the first-entry welcome takeover, and after it the tab bar.
 *
 * The takeover replaces HomeTabs wholesale rather than rendering inside the Home tab (issue #59).
 * Onboarding is a question with three answers on screen; a tab bar under it offers four more
 * destinations that all silently skip the question — so the bar must not be mounted at all.
 * Deciding here also means the tabs never flash up for the frame it takes to read the flags.
 */
export default function HomeRoot({ navigation }: Props): React.JSX.Element {
  const userId = useSession((s) => s.user?.id);
  const displayName = useSession((s) => s.user?.displayName);
  // null while the on-device flags are still unread — neither surface may flash before the answer.
  const [show, setShow] = useState<boolean | null>(null);
  const [tutorialDone, setTutorialDone] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const done = (await getTutorialCompletion(userId)) !== null;
      // A finished tutorial is a resolved onboarding — never offer the choice again.
      const first = done ? false : await shouldShowWelcome(userId);
      if (!alive) return;
      setTutorialDone(done);
      setShow(first);
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  const dismiss = useCallback((): void => {
    setShow(false);
    void markWelcomeSeen(userId);
  }, [userId]);

  if (show === null) return <Screen />;
  if (!show) return <HomeTabs />;
  return (
    <WelcomeScreen
      name={displayName ?? ''}
      tutorialDone={tutorialDone}
      onStartTutorial={() => {
        dismiss();
        navigation.navigate('Tutorial');
      }}
      onPractice={() => {
        dismiss();
        navigation.navigate('OfflineSetup');
      }}
      onContinue={dismiss}
    />
  );
}
