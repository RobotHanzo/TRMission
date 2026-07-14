# Sound effect credits

Most in-game sound effects are sourced from **[Mixkit](https://mixkit.co/free-sound-effects/)** and
used under the **Mixkit Free Sound Effects License** — free for commercial and non-commercial use,
no attribution required. Source: <https://mixkit.co/license/#sfxFree>. We credit them here anyway.
The two per-turn **countdown** cues are instead **synthesized from scratch** with `ffmpeg` (pure
tones — no third-party sample, so no licence attaches); see "Synthesized cues" below.

Each entry lists the in-repo filename, the cue it powers, the original Mixkit sound (name + id), the
direct asset URL, and any editing applied. Edits were done with `ffmpeg` 5.x (recipes below are
reproducible from the original Mixkit download).

| File                   | Cue                                     | Mixkit sound                             | id   | Edited?                                  |
| ---------------------- | --------------------------------------- | ---------------------------------------- | ---- | ---------------------------------------- |
| `card-draw.mp3`        | Card draw                               | Poker card flick                         | 2002 | —                                        |
| `your-turn.mp3`        | Your turn                               | Elegant door announcement                | 224  | ✅ trim + 2× speed (pitch-up)            |
| `tunnel-draw.mp3`      | Tunnel reveal (played 3×, one per card) | Poker card placement                     | 2001 | —                                        |
| `tunnel-success.mp3`   | Tunnel needs no surcharge               | Achievement bell                         | 600  | —                                        |
| `tunnel-payment.mp3`   | Tunnel needs extra payment              | Negative tone interface tap              | 2569 | —                                        |
| `mission-complete.mp3` | Ticket/mission completed (self)         | Arcade game complete or approved mission | 205  | —                                        |
| `game-over-win.mp3`    | Game over — you won                     | Successful horns fanfare                 | 722  | —                                        |
| `game-over-normal.mp3` | Game over — you didn't win              | Orchestral violin jingle                 | 2280 | —                                        |
| `station-built.mp3`    | Station built                           | Metal hammer hit                         | 833  | ✅ trim + ×3 + pitch-down/bass (heavier) |
| `railway-built.mp3`    | Railway claimed                         | Wood hard hit                            | 2182 | ✅ trim + ×3                             |
| `event-start.mp3`      | Random event start banner               | Game level completed                     | 2059 | —                                        |
| `chat-message.mp3`     | Chat message received                   | Message pop alert                        | 2354 | —                                        |

Synthesized (not Mixkit — see "Synthesized cues" below):

| File                    | Cue                                     | Source         | Edited?           |
| ----------------------- | --------------------------------------- | -------------- | ----------------- |
| `countdown-warning.mp3` | Per-turn countdown tick (final seconds) | ffmpeg (synth) | ✅ generated tone |
| `countdown-lapsed.mp3`  | Per-turn countdown lapsed (time's up)   | ffmpeg (synth) | ✅ generated tone |

Direct asset URLs follow the pattern
`https://assets.mixkit.co/active_storage/sfx/<id>/<id>.wav` (full) or `<id>-preview.mp3` (the
web-sized mp3 shipped here). e.g. card-draw = <https://assets.mixkit.co/active_storage/sfx/2002/2002-preview.mp3>.

## Notes

- **`tunnel-draw.mp3`** intentionally reuses the _card-placement_ timbre (distinct from `card-draw`):
  the tunnel reveal fires it **once per revealed card (3×)**, synced to the card-flip stagger in
  `TunnelModal`, rather than playing a single long whoosh.
- **`event-start.mp3`** (Mixkit "Game level completed", 2059) was previously kept in reserve
  (`future/mission-complete-levelup.mp3`) for the random-event system; now wired to the
  `randomEventStarted` event.

## Edit recipes (ffmpeg)

Common trim macro (strip leading/trailing near-silence):

```
LEAD="silenceremove=start_periods=1:start_threshold=-50dB:detection=peak"
TAIL="areverse,silenceremove=start_periods=1:start_threshold=-55dB:detection=peak,areverse"
```

**your-turn.mp3** — from Mixkit 224, trimmed then true 2× speed (tempo + pitch up an octave):

```
ffmpeg -i 224.mp3 -af "aformat=channel_layouts=mono,aresample=44100,$LEAD,$TAIL,asetrate=88200,aresample=44100" your-turn.mp3
```

**station-built.mp3** — from Mixkit 833, trimmed (keep the ring tail at -62 dB), pitched down ~18%
with a low-shelf boost for weight, then three deliberate strikes 180 ms apart:

```
ffmpeg -i 833.mp3 -f lavfi -t 0.18 -i anullsrc=r=44100:cl=mono \
 -filter_complex "[0:a]aformat=channel_layouts=mono,aresample=44100,$LEAD,areverse,silenceremove=start_periods=1:start_threshold=-62dB:detection=peak,areverse,asetrate=36162,aresample=44100,bass=g=7:f=110,volume=2dB,alimiter=limit=0.95,asplit=3[h1][h2][h3];[1:a]aformat=channel_layouts=mono,aresample=44100,asplit=2[g1][g2];[h1][g1][h2][g2][h3]concat=n=5:v=0:a=1[out]" \
 -map "[out]" -codec:a libmp3lame -q:a 4 station-built.mp3
```

**railway-built.mp3** — from Mixkit 2182, trimmed then three quick clacks 100 ms apart:

```
ffmpeg -i 2182.mp3 -f lavfi -t 0.10 -i anullsrc=r=44100:cl=mono \
 -filter_complex "[0:a]aformat=channel_layouts=mono,aresample=44100,$LEAD,$TAIL,asplit=3[h1][h2][h3];[1:a]aformat=channel_layouts=mono,aresample=44100,asplit=2[g1][g2];[h1][g1][h2][g2][h3]concat=n=5:v=0:a=1[out]" \
 -map "[out]" -codec:a libmp3lame -q:a 4 railway-built.mp3
```

## Synthesized cues (original, no third-party sample)

The two per-turn countdown cues (issue #13) are pure synthesized tones — no Mixkit or other sample
is involved, so no licence attaches. Reproducible from ffmpeg alone:

**countdown-warning.mp3** — a short high blip fired once per second in the final seconds of a turn:

```
ffmpeg -y -f lavfi -i "sine=frequency=920:duration=0.12" \
 -af "afade=t=in:st=0:d=0.005,afade=t=out:st=0.05:d=0.07,volume=0.85" \
 -ac 1 -ar 44100 -codec:a libmp3lame -b:a 128k countdown-warning.mp3
```

**countdown-lapsed.mp3** — a descending two-note "time's up" the instant the countdown hits zero:

```
ffmpeg -y -f lavfi -i "sine=frequency=640:duration=0.18" -f lavfi -i "sine=frequency=430:duration=0.30" \
 -filter_complex "[0:a]afade=t=in:st=0:d=0.005,afade=t=out:st=0.12:d=0.06[a0];[1:a]afade=t=in:st=0:d=0.005,afade=t=out:st=0.16:d=0.14[a1];[a0][a1]concat=n=2:v=0:a=1,volume=0.9[out]" \
 -map "[out]" -ac 1 -ar 44100 -codec:a libmp3lame -b:a 128k countdown-lapsed.mp3
```
