import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { legalActions, taiwanBoard } from '@trm/engine';
import type { Payment as EnginePayment } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import '../../../i18n';
import type { SandboxSocket } from '../../../net/sandboxSocket';
import { paymentToProto } from '../../../game/payments';
import type { Beat } from '../types';
import { lessonsForScope } from '../curriculum';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
import AsyncStorage from '@react-native-async-storage/async-storage';

// The Skia game stage is P2's test surface; here it is a pass-through that surfaces the overlay
// and captures `commands` so the test can play the learner's moves through the REAL sandbox.
let mockStageProps: Record<string, unknown> | null = null;
jest.mock('../../../screens/GameStage', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    GameStage: (props: Record<string, unknown>) => {
      mockStageProps = props;
      return React.createElement(React.Fragment, null, props.overlay as React.ReactNode);
    },
  };
});

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

import TutorialScreen from '../TutorialScreen';

/** The tutorial sandbox is events-off, so an engine payment never carries the event-only flags
 *  (bentoSpend / useClaimDiscount) — drop them to satisfy the client Payment's stricter types. */
const toWirePayment = (p: EnginePayment) =>
  paymentToProto({ color: p.color, colorCount: p.colorCount, locomotives: p.locomotives });

/** Perform an await beat's expected move through the live sandbox (mirrors scenarios.spec.ts). */
function performAwait(sandbox: SandboxSocket, beat: Extract<Beat, { mode: 'await' }>): void {
  const s = sandbox.getState();
  const offer = [...(s.players['you']?.pendingTicketOffer ?? [])] as string[];
  switch (beat.expect.t) {
    case 'KEEP_INITIAL_TICKETS':
      sandbox.keepInitialTickets(offer);
      break;
    case 'KEEP_TICKETS':
      sandbox.keepTickets(offer.slice(0, 1));
      break;
    case 'DRAW_ANY':
    case 'DRAW_BLIND':
      sandbox.drawBlind();
      break;
    case 'DRAW_TICKETS':
      sandbox.drawTickets();
      break;
    case 'PASS':
      sandbox.pass();
      break;
    case 'CLAIM_ROUTE': {
      const want = beat.expect.routeId;
      const a = legalActions(taiwanBoard(), s, asPlayerId('you')).find(
        (x) => x.t === 'CLAIM_ROUTE' && (!want || (x.routeId as string) === want),
      );
      if (!a || a.t !== 'CLAIM_ROUTE')
        throw new Error(`no legal CLAIM_ROUTE for ${want ?? '(any)'}`);
      sandbox.claimRoute(a.routeId as string, toWirePayment(a.payment));
      break;
    }
    case 'BUILD_STATION': {
      const want = beat.expect.cityId;
      const a = legalActions(taiwanBoard(), s, asPlayerId('you')).find(
        (x) => x.t === 'BUILD_STATION' && (!want || (x.cityId as string) === want),
      );
      if (!a || a.t !== 'BUILD_STATION')
        throw new Error(`no legal BUILD_STATION for ${want ?? '(any)'}`);
      sandbox.buildStation(a.cityId as string, toWirePayment(a.payment));
      break;
    }
    default:
      throw new Error(`walkthrough cannot synthesize await ${beat.expect.t}`);
  }
}

describe('scripted end-to-end Quickstart walkthrough', () => {
  it('travels every core lesson to the finale and persists completion', async () => {
    jest.useFakeTimers();
    const r = render(<TutorialScreen />);
    fireEvent.press(r.getByTestId('tut-scope-core'));

    const lessons = lessonsForScope('core');
    for (let li = 0; li < lessons.length; li++) {
      const lesson = lessons[li]!;
      const isLastLesson = li === lessons.length - 1;
      for (let bi = 0; bi < lesson.beats.length; bi++) {
        const beat = lesson.beats[bi]!;
        const isLastBeat = bi === lesson.beats.length - 1;
        if (beat.mode === 'info') {
          // The last info beat of a non-final lesson hands off via "next lesson".
          const btn =
            isLastBeat && !isLastLesson
              ? r.getByTestId('tut-next-lesson')
              : r.getByTestId('tut-next');
          fireEvent.press(btn);
        } else if (beat.mode === 'await') {
          const sandbox = mockStageProps!.commands as SandboxSocket;
          act(() => performAwait(sandbox, beat));
        } else {
          // auto beat: the player fires its scripted action on a timer.
          act(() => {
            jest.advanceTimersByTime((beat.delayMs ?? 900) + 50);
          });
        }
        await act(async () => {}); // flush projections/re-renders
        // A done lesson (last beat consumed) rolls into the next one via the done-state button.
        if (isLastBeat && beat.mode !== 'info' && !isLastLesson) {
          fireEvent.press(r.getByTestId('tut-next-lesson'));
          await act(async () => {});
        }
      }
    }

    // Whole-tutorial finale: celebratory CTA on screen, completion persisted.
    await waitFor(() => expect(r.getByTestId('tut-finale-cta')).toBeTruthy());
    await waitFor(async () =>
      expect(await AsyncStorage.getItem('trm.tutorial.completed.v1')).toContain('"core"'),
    );
    jest.useRealTimers();
  }, 60_000);
});
