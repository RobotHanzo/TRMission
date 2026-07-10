// Original vector rolling-stock, ported 1:1 from the web TrainCarArt (clean-room artwork —
// nothing traced from any rulebook art) onto react-native-svg. A vintage side-profile passenger
// carriage for the eight colours; a steam locomotive for the wild LOCOMOTIVE card. The whole
// drawing derives from a single card-colour hex so every colour reads as the same vehicle in a
// different livery. viewBox is a fixed 132×72 so the card can scale it freely.
import { useId } from 'react';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';
import type { CardColor } from '@trm/shared';
import { CARD_COLOR_TOKENS } from '../../theme/colors';
import { shade, tint, luminance } from '../../theme/shade';

export function TrainCarArt({ color }: { color: CardColor }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const hex = CARD_COLOR_TOKENS[color].hex;
  return color === 'LOCOMOTIVE' ? <Locomotive uid={uid} /> : <Carriage uid={uid} hex={hex} />;
}

/* ── Passenger carriage ──────────────────────────────────────────────────────── */
function Carriage({ uid, hex }: { uid: string; hex: string }) {
  const bodyTop = tint(hex, 0.26);
  const bodyBot = shade(hex, 0.22);
  const roof = shade(hex, 0.5);
  const roofTop = shade(hex, 0.36);
  const belt = shade(hex, 0.4);
  const glass = luminance(hex) > 0.6 ? shade(hex, 0.16) : tint(hex, 0.66);
  const glassEdge = shade(hex, 0.3);
  const metal = '#2c2722';
  const hub = tint(hex, 0.34);

  const windows = [18, 36.5, 55, 73.5, 92];
  return (
    <Svg viewBox="0 0 132 72" width="100%" height="100%">
      <Defs>
        <LinearGradient id={`body-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={bodyTop} />
          <Stop offset="0.55" stopColor={hex} />
          <Stop offset="1" stopColor={bodyBot} />
        </LinearGradient>
        <LinearGradient id={`glass-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={tint(glass, 0.34)} />
          <Stop offset="1" stopColor={glass} />
        </LinearGradient>
      </Defs>

      <Ellipse cx="66" cy="64.5" rx="52" ry="3.4" fill="rgba(0,0,0,0.16)" />

      <G fill={metal}>
        <Rect x="24" y="50" width="22" height="5" rx="1.4" />
        <Rect x="86" y="50" width="22" height="5" rx="1.4" />
      </G>
      {[30, 40, 92, 102].map((cx) => (
        <G key={cx}>
          <Circle cx={cx} cy={55} r="4.6" fill={metal} />
          <Circle cx={cx} cy={55} r="1.7" fill={hub} />
        </G>
      ))}

      <Circle cx="9.5" cy="44" r="1.7" fill={belt} />
      <Circle cx="122.5" cy="44" r="1.7" fill={belt} />

      <Rect x="36" y="6" width="60" height="8" rx="3.4" fill={roofTop} />
      <Rect x="14" y="11.5" width="104" height="9" rx="4.5" fill={roof} />

      <Rect x="13" y="19" width="106" height="30" rx="4.2" fill={`url(#body-${uid})`} />
      <Rect x="15" y="48" width="102" height="3.4" rx="1" fill={belt} />

      <G>
        {windows.map((x) => (
          <Rect
            key={x}
            x={x}
            y="24"
            width="13.5"
            height="12"
            rx="2"
            fill={`url(#glass-${uid})`}
            stroke={glassEdge}
            strokeWidth="0.7"
          />
        ))}
      </G>
      <Line x1="15" y1="39.5" x2="117" y2="39.5" stroke={belt} strokeWidth="1.1" />
      <Rect x="16" y="41" width="100" height="5" rx="1.5" fill={tint(hex, 0.18)} opacity="0.5" />
    </Svg>
  );
}

/* ── Steam locomotive (the wild card) ────────────────────────────────────────── */
function Locomotive({ uid }: { uid: string }) {
  const steel = CARD_COLOR_TOKENS.LOCOMOTIVE.hex;
  const dark = shade(steel, 0.62);
  const mid = shade(steel, 0.3);
  const light = tint(steel, 0.4);
  const hub = tint(steel, 0.55);
  const rainbow = ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE'] as const;

  return (
    <Svg viewBox="0 0 132 72" width="100%" height="100%">
      <Defs>
        <LinearGradient id={`boiler-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={light} />
          <Stop offset="0.5" stopColor={steel} />
          <Stop offset="1" stopColor={mid} />
        </LinearGradient>
      </Defs>

      <Ellipse cx="66" cy="64.5" rx="54" ry="3.4" fill="rgba(0,0,0,0.18)" />

      <Rect x="12" y="13" width="30" height="30" rx="3" fill={`url(#boiler-${uid})`} />
      <Rect x="12" y="11" width="30" height="5" rx="2" fill={dark} />
      <Rect
        x="17"
        y="18"
        width="14"
        height="11"
        rx="2"
        fill={tint(steel, 0.62)}
        stroke={dark}
        strokeWidth="0.8"
      />

      <Rect x="38" y="24" width="64" height="19" rx="9.5" fill={`url(#boiler-${uid})`} />
      <Rect x="42" y="25.4" width="56" height="2.6" rx="1.3" fill="rgba(255,255,255,0.42)" />
      <Rect x="15" y="15" width="24" height="1.9" rx="1" fill="rgba(255,255,255,0.32)" />
      <Ellipse cx="99" cy="30" rx="2.4" ry="4.4" fill="rgba(255,255,255,0.28)" />
      {[52, 66, 80].map((x) => (
        <Line key={x} x1={x} y1="25" x2={x} y2="42" stroke={mid} strokeWidth="1" opacity="0.7" />
      ))}
      <Circle cx="101" cy="33.5" r="9.6" fill={mid} />
      <Circle cx="101" cy="33.5" r="9.6" fill="none" stroke={dark} strokeWidth="1" />
      <Circle cx="106" cy="28" r="2.2" fill={tint(steel, 0.7)} stroke={dark} strokeWidth="0.5" />

      <Path d="M86 24 L98 24 L95.5 11 L88.5 11 Z" fill={dark} />
      <Rect x="86" y="9" width="13" height="3.5" rx="1.5" fill={mid} />
      <Path d="M60 24 a7 7 0 0 1 14 0 Z" fill={dark} />
      <Path d="M46 24 a5 5 0 0 1 10 0 Z" fill={mid} />

      <Rect x="30" y="43" width="78" height="3.6" rx="1" fill={dark} />
      <Path d="M108 43 L118 56 L102 56 Z" fill={mid} stroke={dark} strokeWidth="0.6" />

      {[
        { cx: 52, r: 8.4 },
        { cx: 74, r: 8.4 },
        { cx: 97, r: 5 },
      ].map(({ cx, r }) => (
        <G key={cx}>
          <Circle cx={cx} cy={54} r={r} fill={dark} />
          <Circle cx={cx} cy={54} r={r * 0.42} fill={hub} />
          {[0, 60, 120].map((a) => {
            const rad = (a * Math.PI) / 180;
            return (
              <Line
                key={a}
                x1={cx}
                y1={54}
                x2={cx + Math.cos(rad) * r * 0.78}
                y2={54 + Math.sin(rad) * r * 0.78}
                stroke={mid}
                strokeWidth="1"
              />
            );
          })}
        </G>
      ))}
      <Line x1="52" y1="54" x2="74" y2="54" stroke={mid} strokeWidth="2.2" strokeLinecap="round" />

      <G stroke="rgba(0,0,0,0.28)" strokeWidth="0.3">
        {rainbow.map((c, i) => (
          <Rect
            key={c}
            x={13 + i * 5.6}
            y="46.4"
            width="5"
            height="4.2"
            rx="0.8"
            fill={CARD_COLOR_TOKENS[c].hex}
          />
        ))}
        <Rect
          x="13"
          y="46.6"
          width="33.6"
          height="1.1"
          rx="0.5"
          fill="rgba(255,255,255,0.45)"
          stroke="none"
        />
      </G>
    </Svg>
  );
}
