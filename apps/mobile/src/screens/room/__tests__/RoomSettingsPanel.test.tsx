// The lobby's layered settings board (issue #64): the index has to state each group's current
// value on its own, and a group's controls have to be one press away — and read-only for anyone
// but the host.
import { fireEvent, render, screen } from '@testing-library/react-native';
import '../../../i18n';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import type { RoomSettings } from '../../../net/rest';
import { RoomSettingsPanel } from '../RoomSettingsPanel';

const SETTINGS: RoomSettings = {
  unlimitedStationBorrow: true,
  secondDrawAfterBlindRainbow: false,
  noUnfinishedTicketPenalty: false,
  doubleRouteSingleFor23: true,
  allowSpectating: true,
  visibility: 'PUBLIC',
  map: { source: 'official', mapId: 'taiwan' },
  eventsMode: 'moderate',
  teamCount: 0,
  teamAssignMode: 'host',
  soloWaitForHost: true,
};

const onChange = jest.fn();
const onChangeTeamCount = jest.fn();

const renderPanel = (over: Partial<React.ComponentProps<typeof RoomSettingsPanel>> = {}) =>
  render(
    <RoomSettingsPanel
      settings={SETTINGS}
      locked={false}
      canBuild={false}
      showEvents
      showSoloWait={false}
      seatedCount={2}
      myMaps={null}
      officialMapIds={null}
      mapName="台灣本島與離島"
      locale="zh-Hant"
      onChange={onChange}
      onChangeTeamCount={onChangeTeamCount}
      {...over}
    />,
  );

beforeEach(() => {
  onChange.mockClear();
  onChangeTeamCount.mockClear();
});

describe('RoomSettingsPanel index', () => {
  it('states each group current value on the row itself', async () => {
    // The accessibility label is "title — value", which is also what a screen reader announces.
    await renderPanel();
    expect(screen.getByLabelText('地圖 — 台灣本島與離島')).toBeTruthy();
    expect(screen.getByLabelText('行車規則 — 車站借用 · 平行單線')).toBeTruthy();
    expect(screen.getByLabelText('隨機事件 — 中度')).toBeTruthy();
    expect(screen.getByLabelText('組隊模式 — 各自為戰')).toBeTruthy();
    expect(screen.getByLabelText('房間開放 — 公開 · 開放觀戰')).toBeTruthy();
  });

  it('leaves the events group off the board when the picker is hidden', async () => {
    await renderPanel({ showEvents: false });
    expect(screen.queryByTestId('room-settings-nav-events')).toBeNull();
  });

  it('warns on the team row when the seated count cannot form that many teams', async () => {
    await renderPanel({ settings: { ...SETTINGS, teamCount: 3 }, seatedCount: 4 });
    expect(screen.getByText('3 隊需要 6 位玩家（目前 4 位）')).toBeTruthy();
  });

  it('says only the host can change the settings, when that is the case', async () => {
    await renderPanel({ locked: true });
    expect(screen.getByText('只有房主可以變更設定。')).toBeTruthy();
  });
});

describe('RoomSettingsPanel group pages', () => {
  it('opens a group and patches from it, then closes back to the index', async () => {
    await renderPanel();
    await fireEvent.press(screen.getByTestId('room-settings-nav-rules'));
    await fireEvent(screen.getByLabelText('未完成任務不扣分'), 'valueChange', true);
    expect(onChange).toHaveBeenCalledWith({ noUnfinishedTicketPenalty: true });

    await fireEvent.press(screen.getByTestId('room-settings-back'));
    expect(screen.queryByTestId('room-settings-back')).toBeNull();
  });

  it('routes the team count through the room guard, not a raw patch', async () => {
    await renderPanel();
    await fireEvent.press(screen.getByTestId('room-settings-nav-teams'));
    await fireEvent.press(screen.getByText('兩隊'));
    expect(onChangeTeamCount).toHaveBeenCalledWith(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps a non-host page readable but read-only', async () => {
    await renderPanel({ locked: true });
    await fireEvent.press(screen.getByTestId('room-settings-nav-events'));
    // The chosen mode still reads (on the index behind, and as a chip on the page);
    // pressing another one does nothing.
    expect(screen.getAllByText('中度').length).toBeGreaterThan(1);
    await fireEvent.press(screen.getByText('強烈'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the resolved map name instead of a picker to someone who cannot edit', async () => {
    await renderPanel({ locked: true });
    await fireEvent.press(screen.getByTestId('room-settings-nav-map'));
    expect(screen.getAllByText('台灣本島與離島').length).toBeGreaterThan(0);
  });

  it('tags the team-mode map in the picker, credit and all', async () => {
    await renderPanel();
    await fireEvent.press(screen.getByTestId('room-settings-nav-map'));
    expect(screen.getByText('大臺北軌道交通（嶼翼） · 推薦組隊模式')).toBeTruthy();
  });

  it('leaves an official map the server switched off out of the host picker', async () => {
    await renderPanel({ officialMapIds: ['taiwan'] });
    await fireEvent.press(screen.getByTestId('room-settings-nav-map'));
    expect(screen.getAllByText('台灣本島與離島').length).toBeGreaterThan(0);
    expect(screen.queryByText('大台北')).toBeNull();
  });
});
