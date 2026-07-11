// NetInfo-driven online/offline posture (spec §8). Online features render disabled behind
// the OfflineHomeBanner when this is false; offline entries (Play vs Bots, Tutorial) never gate.
import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(
    () =>
      NetInfo.addEventListener((s) => {
        setOnline(!!s.isConnected && s.isInternetReachable !== false);
      }),
    [],
  );
  return online;
}
