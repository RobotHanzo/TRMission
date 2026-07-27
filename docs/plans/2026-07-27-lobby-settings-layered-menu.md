# Lobby settings: a layered board (issue #64)

The room's game settings were one flat card of ~9 controls on both clients. This makes them the
same shape as the mobile Settings tab (issue #47): an **index** naming each group and stating what
it is currently set to, over **one page per group** holding the controls.

## Why layered is not a loss

Adding a layer normally costs the reader an answer. It doesn't here because the index states every
group's current value on a dotted timetable leader — the idiom already used by the mobile Settings
index, the HUD tray heads, and the player card's ledger. "What is this table set to?" is answered
without opening anything; only _changing_ something costs a press.

## Groups

Five, in board order. The value column is the whole point, so each has a one-line reading:

| Group           | Value reads                                       |
| --------------- | ------------------------------------------------- |
| 地圖 Map        | the resolved map name                             |
| 行車規則 Rules  | short labels of the rules in force, or "all off"  |
| 隨機事件 Events | the intensity (absent unless the picker is shown) |
| 組隊模式 Teams  | team count · assignment method                    |
| 房間開放 Access | visibility · spectating                           |

`soloWaitForHost` joins the rules group (it is a rule about how turns run at this table) and only
while it applies — exactly one human seated. The team-layout warning ("3 teams need 6 players")
rides the team row on the index and repeats on its page, so an unstartable line-up is visible
before the host presses Start.

## Shape of the change

- **`@trm/client-core/game/roomSettingsMenu.ts`** — the part both clients must agree on: the group
  list and order, which rules live where, each group's value string, and the team-layout warning.
  Takes a bound translator so web (`t`) and mobile (`t('room.…')`) both fit. Covered by
  `test/roomSettingsMenu.spec.ts`.
- **`apps/web/components/RoomSettingsPanel.tsx`** + `.rsm-*` in `styles/room.css` — the board swaps
  in place between index and one group's page; the controls stay in a `<fieldset disabled>`, so the
  non-host read-only semantics are unchanged.
- **`apps/mobile/screens/room/RoomSettingsPanel.tsx`** — the index reuses `settings/chrome.tsx`'s
  `NavRow`/`SettingsRow`/`ChoiceRow` outright, so the two boards are literally one design. A
  group's page is a **Modal, not a pushed route**: `RoomScreen` owns the poll that keeps `settings`
  live. `ChoiceRow` gained a `disabled` prop for the read-only case.

## The read-only voice

The board is posted, not owned — everyone in the room reads it, only the host writes it. A locked
board says so once ("Only the host can change these."), keeps every group openable, and renders the
controls disabled rather than hiding them. Hiding them would make a member unable to find out what
"unlimited station borrowing" even means.

## Not touched

`OfflineSetupScreen` (mobile) configures a local game, not a room — a different surface with its
own, shorter set of choices. Left flat.
