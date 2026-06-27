import { useId } from 'react';
import type { CardColor } from '@trm/shared';
import { CARD_COLOR_TOKENS } from '../theme/colors';
import { shade, tint, luminance } from '../theme/shade';

/**
 * Original vector rolling-stock, drawn from scratch (clean-room — nothing traced
 * from any rulebook art). A vintage side-profile passenger carriage for the eight
 * colours; a steam locomotive for the wild LOCOMOTIVE card. The whole drawing is
 * derived from a single card-colour hex so every colour reads as the same vehicle
 * in a different livery. viewBox is a fixed 132×72 so the card can scale it freely.
 */
export function TrainCarArt({ color }: { color: CardColor }) {
  const uid = useId().replace(/:/g, '');
  const hex = CARD_COLOR_TOKENS[color].hex;
  return color === 'LOCOMOTIVE' ? <Locomotive uid={uid} /> : <Carriage uid={uid} hex={hex} />;
}

/* ── Passenger carriage ──────────────────────────────────────────────────────── */
function Carriage({ uid, hex }: { uid: string; hex: string }) {
  // Livery derived entirely from the card hex so the body, roof and glazing
  // stay in one harmonious family at any colour.
  const bodyTop = tint(hex, 0.26);
  const bodyBot = shade(hex, 0.22);
  const roof = shade(hex, 0.5);
  const roofTop = shade(hex, 0.36);
  const belt = shade(hex, 0.4);
  // Pale glass on dark liveries, slightly tinted glass on light ones — keeps the
  // windows reading as glass against black/white cars alike.
  const glass = luminance(hex) > 0.6 ? shade(hex, 0.16) : tint(hex, 0.66);
  const glassEdge = shade(hex, 0.3);
  const metal = '#2c2722';
  const hub = tint(hex, 0.34);

  const windows = [18, 36.5, 55, 73.5, 92];
  return (
    <svg viewBox="0 0 132 72" className="rs-art" aria-hidden focusable="false">
      <defs>
        <linearGradient id={`body-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={bodyTop} />
          <stop offset="0.55" stopColor={hex} />
          <stop offset="1" stopColor={bodyBot} />
        </linearGradient>
        <linearGradient id={`glass-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={tint(glass, 0.34)} />
          <stop offset="1" stopColor={glass} />
        </linearGradient>
      </defs>

      {/* ground shadow */}
      <ellipse cx="66" cy="64.5" rx="52" ry="3.4" fill="rgba(0,0,0,0.16)" />

      {/* bogies + wheels */}
      <g fill={metal}>
        <rect x="24" y="50" width="22" height="5" rx="1.4" />
        <rect x="86" y="50" width="22" height="5" rx="1.4" />
      </g>
      {[30, 40, 92, 102].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy={55} r="4.6" fill={metal} />
          <circle cx={cx} cy={55} r="1.7" fill={hub} />
        </g>
      ))}

      {/* buffers */}
      <circle cx="9.5" cy="44" r="1.7" fill={belt} />
      <circle cx="122.5" cy="44" r="1.7" fill={belt} />

      {/* clerestory + main roof */}
      <rect x="36" y="6" width="60" height="8" rx="3.4" fill={roofTop} />
      <rect x="14" y="11.5" width="104" height="9" rx="4.5" fill={roof} />

      {/* body */}
      <rect x="13" y="19" width="106" height="30" rx="4.2" fill={`url(#body-${uid})`} />
      {/* underframe */}
      <rect x="15" y="48" width="102" height="3.4" rx="1" fill={belt} />

      {/* windows */}
      <g>
        {windows.map((x) => (
          <rect
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
      </g>
      {/* belt line + lower-panel highlight */}
      <line x1="15" y1="39.5" x2="117" y2="39.5" stroke={belt} strokeWidth="1.1" />
      <rect x="16" y="41" width="100" height="5" rx="1.5" fill={tint(hex, 0.18)} opacity="0.5" />
    </svg>
  );
}

/* ── Steam locomotive (the wild card) ────────────────────────────────────────── */
function Locomotive({ uid }: { uid: string }) {
  const steel = CARD_COLOR_TOKENS.LOCOMOTIVE.hex; // neutral grey
  const dark = shade(steel, 0.62);
  const mid = shade(steel, 0.3);
  const light = tint(steel, 0.4);
  const hub = tint(steel, 0.55);
  // Wild = any colour: the six rainbow liveries as a strip on the footplate.
  const rainbow = ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE'] as const;

  return (
    <svg viewBox="0 0 132 72" className="rs-art" aria-hidden focusable="false">
      <defs>
        <linearGradient id={`boiler-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="0.5" stopColor={steel} />
          <stop offset="1" stopColor={mid} />
        </linearGradient>
      </defs>

      <ellipse cx="66" cy="64.5" rx="54" ry="3.4" fill="rgba(0,0,0,0.18)" />

      {/* cab (rear / left) */}
      <rect x="12" y="13" width="30" height="30" rx="3" fill={`url(#boiler-${uid})`} />
      <rect x="12" y="11" width="30" height="5" rx="2" fill={dark} />
      <rect x="17" y="18" width="14" height="11" rx="2" fill={tint(steel, 0.62)} stroke={dark} strokeWidth="0.8" />

      {/* boiler */}
      <rect x="38" y="24" width="64" height="19" rx="9.5" fill={`url(#boiler-${uid})`} />
      {/* polished sheen along the boiler + cab */}
      <rect x="42" y="25.4" width="56" height="2.6" rx="1.3" fill="rgba(255,255,255,0.42)" />
      <rect x="15" y="15" width="24" height="1.9" rx="1" fill="rgba(255,255,255,0.32)" />
      <ellipse cx="99" cy="30" rx="2.4" ry="4.4" fill="rgba(255,255,255,0.28)" />
      {/* boiler bands */}
      {[52, 66, 80].map((x) => (
        <line key={x} x1={x} y1="25" x2={x} y2="42" stroke={mid} strokeWidth="1" opacity="0.7" />
      ))}
      {/* smokebox front cap + headlamp */}
      <circle cx="101" cy="33.5" r="9.6" fill={mid} />
      <circle cx="101" cy="33.5" r="9.6" fill="none" stroke={dark} strokeWidth="1" />
      <circle cx="106" cy="28" r="2.2" fill={tint(steel, 0.7)} stroke={dark} strokeWidth="0.5" />

      {/* chimney + steam dome */}
      <path d={`M86 24 L98 24 L95.5 11 L88.5 11 Z`} fill={dark} />
      <rect x="86" y="9" width="13" height="3.5" rx="1.5" fill={mid} />
      <path d="M60 24 a7 7 0 0 1 14 0 Z" fill={dark} />
      <path d="M46 24 a5 5 0 0 1 10 0 Z" fill={mid} />

      {/* running board + pilot (cowcatcher) */}
      <rect x="30" y="43" width="78" height="3.6" rx="1" fill={dark} />
      <path d="M108 43 L118 56 L102 56 Z" fill={mid} stroke={dark} strokeWidth="0.6" />

      {/* wheels: two big drivers + a leading wheel, with a coupling rod */}
      {[
        { cx: 52, r: 8.4 },
        { cx: 74, r: 8.4 },
        { cx: 97, r: 5 },
      ].map(({ cx, r }) => (
        <g key={cx}>
          <circle cx={cx} cy={54} r={r} fill={dark} />
          <circle cx={cx} cy={54} r={r * 0.42} fill={hub} />
          {[0, 60, 120].map((a) => {
            const rad = (a * Math.PI) / 180;
            return (
              <line
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
        </g>
      ))}
      <line x1="52" y1="54" x2="74" y2="54" stroke={mid} strokeWidth="2.2" strokeLinecap="round" />

      {/* wild-card rainbow livery strip, on the footplate under the cab */}
      <g stroke="rgba(0,0,0,0.28)" strokeWidth="0.3">
        {rainbow.map((c, i) => (
          <rect
            key={c}
            x={13 + i * 5.6}
            y="46.4"
            width="5"
            height="4.2"
            rx="0.8"
            fill={CARD_COLOR_TOKENS[c].hex}
          />
        ))}
        {/* glint across the strip */}
        <rect x="13" y="46.6" width="33.6" height="1.1" rx="0.5" fill="rgba(255,255,255,0.45)" stroke="none" />
      </g>
    </svg>
  );
}
