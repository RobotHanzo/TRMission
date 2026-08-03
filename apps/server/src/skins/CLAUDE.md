# CLAUDE.md

`src/skins/` owns **cosmetics availability** — which train-card skin packs players may pick. The
packs themselves are pure client artwork (`@trm/client-core/art/skins`); nothing here touches an
SVG, and a skin never reaches the engine, the wire, or a game document.

- **`trainCarSkinConfig`** — one singleton doc holding the **disabled** `TrainCarSkin` ids, edited
  from the dashboard's Features panel (`GET/PUT /dashboard/config/train-car-skins`, permission
  `config.features`, audited as `config.trainCarSkins`). Storing the negative is deliberate: a pack
  added to `TRAIN_CAR_SKINS` in a later release ships on offer instead of going missing from a
  saved allowlist. Read fresh on every use, never cached.
- `GET /skins/train-cars/enabled` is ungated beyond a valid session, for the same reason as
  `GET /maps/official/enabled`: every player's settings screen reads it.

## The two rules that differ from official maps

Both follow from a skin being cosmetic and per viewer, where a map is a shared game input.

1. **The default pack can never be switched off.** `setTrainCarSkinAvailability` forces it back on
   whether or not the PUT named it, so an empty set collapses to the default rather than 400-ing.
   It is the fallback every disabled or unknown selection resolves to — with it off, cards would
   have no artwork at all.
2. **A switched-off pack is NOT rejected on `PATCH /auth/me/preferences`.** Preferences save as one
   blob, so 400-ing the skin field would also block that account from changing its theme or
   language. The pack stops being offered and stops being drawn (the client resolves it back to the
   default via `@trm/client-core/game/trainCarSkins`); the stored value is left alone, so switching
   the pack back on restores everyone who had picked it.
