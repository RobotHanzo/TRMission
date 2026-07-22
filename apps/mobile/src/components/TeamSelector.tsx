// Replaces the flat member list whenever team mode is on — mirrors apps/web's TeamSelector
// structure (one "platform board" column per team) with native rendering. See its header comment
// for the interaction model shared across both apps.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bot, Crown, Shuffle, UserMinus, X } from 'lucide-react-native';
import type { RoomMember, RoomSettings, RoomView } from '../net/rest';
import { seatColor, teamColor } from '../theme/colors';
import { RADIUS, SPACE, useTheme } from '../theme/useTheme';
import { SecondaryButton } from '../theme/chrome';

type TeamAssignMode = RoomSettings['teamAssignMode'];

const HINT_KEY: Record<TeamAssignMode, string> = {
  random: 'room.teamHintRandom',
  host: 'room.teamHintHost',
  self: 'room.teamHintSelf',
};

interface TeamSelectorProps {
  room: RoomView;
  isHost: boolean;
  myUserId: string | undefined;
  memberName: (m: RoomMember) => string;
  onAssign: (userId: string, team: number) => void;
  onJoinTeam: (team: number) => void;
  onShuffle: () => void;
  onRemoveBot: (botId: string) => void;
  onTransferHost: (userId: string) => void;
  onKick: (userId: string) => void;
}

export function TeamSelector({
  room,
  isHost,
  myUserId,
  memberName,
  onAssign,
  onJoinTeam,
  onShuffle,
  onRemoveBot,
  onTransferHost,
  onKick,
}: TeamSelectorProps): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const [selected, setSelected] = useState<string | null>(null);
  const mode = room.settings.teamAssignMode;
  const teamCount = room.settings.teamCount;
  const assignable = mode === 'host' && isHost;

  const teams = Array.from({ length: teamCount }, (_, team) => ({
    team,
    members: room.members
      .filter((m) => m.seat % teamCount === team)
      .sort((a, b) => a.seat - b.seat),
  }));

  const selectChip = (userId: string): void =>
    setSelected((cur) => (cur === userId ? null : userId));
  const dropOnColumn = (team: number): void => {
    if (!assignable || selected === null) return;
    onAssign(selected, team);
    setSelected(null);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={[styles.title, { color: tokens.ink }]}>{t('room.teamSeatingTitle')}</Text>
          <Text style={{ color: tokens.inkSoft, fontSize: 13 }}>{t(HINT_KEY[mode])}</Text>
        </View>
        {isHost && mode === 'random' && (
          <SecondaryButton
            title={t('room.shuffleTeams')}
            onPress={onShuffle}
            icon={<Shuffle size={16} color={tokens.ink} />}
          />
        )}
      </View>
      <View style={styles.board}>
        {teams.map(({ team, members }) => {
          const isMyTeam = members.some((m) => m.userId === myUserId);
          const dropActive =
            assignable && selected !== null && !members.some((m) => m.userId === selected);
          return (
            <View
              key={team}
              style={[styles.column, { borderColor: tokens.line, backgroundColor: tokens.surface }]}
            >
              <Pressable
                accessibilityRole="button"
                disabled={!dropActive}
                onPress={() => dropOnColumn(team)}
                style={[styles.columnHeader, { backgroundColor: teamColor(team) }]}
              >
                <Text style={styles.columnHeaderText}>{t('game.teamName', { n: team + 1 })}</Text>
                <Text style={styles.columnCount}>{members.length}</Text>
              </Pressable>
              <View style={styles.chipList}>
                {members.map((m) => {
                  const chip = (
                    <View style={styles.chipInner}>
                      <View style={[styles.seatDot, { backgroundColor: seatColor(m.seat) }]} />
                      {m.isBot && <Bot size={14} color={tokens.inkSoft} />}
                      <Text style={[styles.chipName, { color: tokens.ink }]} numberOfLines={1}>
                        {memberName(m)}
                        {m.userId === room.hostId ? ` · ${t('room.host')}` : ''}
                        {m.userId === myUserId ? ` · ${t('room.you')}` : ''}
                      </Text>
                      <Text
                        style={[
                          styles.readyBadge,
                          { color: m.isBot || m.ready ? tokens.ok : tokens.inkSoft },
                        ]}
                      >
                        {m.isBot
                          ? t('room.botTag')
                          : m.ready
                            ? t('room.ready')
                            : t('room.notReady')}
                      </Text>
                    </View>
                  );
                  return (
                    <View key={m.userId} style={styles.chipRow} testID={`team-chip-${m.userId}`}>
                      {assignable ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ selected: selected === m.userId }}
                          onPress={() => selectChip(m.userId)}
                          style={[
                            styles.chip,
                            { borderColor: tokens.line, backgroundColor: tokens.surface2 },
                            selected === m.userId && {
                              borderColor: tokens.ember,
                              transform: [{ translateY: -1 }],
                            },
                          ]}
                        >
                          {chip}
                        </Pressable>
                      ) : (
                        <View
                          style={[
                            styles.chip,
                            { borderColor: tokens.line, backgroundColor: tokens.surface2 },
                          ]}
                        >
                          {chip}
                        </View>
                      )}
                      {isHost && m.isBot && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t('room.removeBot')}
                          hitSlop={8}
                          style={styles.iconBtn}
                          onPress={() => onRemoveBot(m.userId)}
                        >
                          <X size={16} color={tokens.inkSoft} />
                        </Pressable>
                      )}
                      {isHost && !m.isBot && m.userId !== room.hostId && (
                        <>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t('room.makeOwner')}
                            hitSlop={8}
                            style={styles.iconBtn}
                            onPress={() => onTransferHost(m.userId)}
                          >
                            <Crown size={16} color={tokens.inkSoft} />
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t('room.kickPlayer')}
                            hitSlop={8}
                            style={styles.iconBtn}
                            onPress={() => onKick(m.userId)}
                          >
                            <UserMinus size={16} color={tokens.inkSoft} />
                          </Pressable>
                        </>
                      )}
                    </View>
                  );
                })}
              </View>
              {mode === 'self' && myUserId && !isMyTeam && (
                <View style={styles.joinBtnWrap}>
                  <SecondaryButton
                    title={t('room.teamJoinButton')}
                    onPress={() => onJoinTeam(team)}
                  />
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: SPACE[3] },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACE[2],
  },
  headText: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '700' },
  board: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE[3] },
  column: {
    flexGrow: 1,
    flexBasis: 220,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACE[3],
    paddingVertical: SPACE[2],
  },
  columnHeaderText: { color: '#fff', fontWeight: '700', letterSpacing: 0.3 },
  columnCount: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  chipList: { padding: SPACE[2], gap: SPACE[2] },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[1] },
  chip: {
    flex: 1,
    borderWidth: 1,
    borderRadius: RADIUS.sm,
    padding: SPACE[2],
  },
  chipInner: { flexDirection: 'row', alignItems: 'center', gap: SPACE[2] },
  seatDot: { width: 10, height: 10, borderRadius: 5 },
  chipName: { flexShrink: 1, fontSize: 14, fontWeight: '600' },
  readyBadge: { marginLeft: 'auto', fontSize: 11, fontWeight: '700' },
  iconBtn: { padding: 6 },
  joinBtnWrap: { padding: SPACE[2], paddingTop: 0 },
});
