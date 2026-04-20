# VS Code Bowling — TODO

## Existing Items (Refined)

- [ ] **3D perspective lane** — Isometric or forced-perspective view giving the lane depth; pins rendered with size falloff toward the back row
- [ ] **Ball roll animation** — Realistic spinning ball with rotation axis tied to velocity vector and directional spin; add lane reflection streak
- [ ] **Play against computer** — AI opponent with selectable difficulty (Easy / Medium / Pro); takes alternating frames; displays AI score card alongside player
- [ ] **Proper graphics overhaul** — Replace procedural shapes with high-fidelity canvas rendering: pin textures, polished ball surface, lane oil sheen, gutter shadow
- [ ] **Control settings panel** — In-game overlay to tune mouse sensitivity, power curve scale, spin multiplier, and toggle aim guide line

---

## Patches · Minor Bug Fixes & Tweaks

- [ ] Power meter does not reset when Space is released before any downward drag — meter should snap to 0 cleanly
- [ ] Cancel-throw hint (`ESC` to cancel) missing from CHARGING state HUD panel
- [ ] Aim guide line is straight; curve it to match the ball's actual predicted hook arc based on current spin
- [ ] Ball aim X position should persist between ball 1 and ball 2 in the same frame (don't snap back to center)
- [ ] Foul line flashes red if the ball's starting position is dragged past it
- [ ] Standing pin count badge (`X pins remaining`) shown during SETTLING state
- [ ] Pin collision impulse sometimes sends pins off the side of the lane visually — clamp pin travel to lane bounds
- [ ] Gutter ball entry plays a distinct visual effect (grey gutter tint pulse) separate from a normal miss
- [ ] Flash message z-order: currently drawn under the start screen overlay on frame 10 game-over transition
- [ ] Score card cumulative total always shows `0` on the first frame before any roll — should be blank
- [ ] `roundRect` polyfill does not handle `r = 0` edge case; guard against division by zero
- [ ] Ball trail opacity fades too quickly at high speed — normalize fade to distance not frame count

---

## Minor Updates · Small Features

- [ ] **Sound effects** — Web Audio API procedural sounds: ball roll rumble, pin impact crack, strike fanfare, spare chime, gutter thud; no external assets required
- [ ] **Ball color picker** — 5 preset ball colors (blue, red, black, green, purple) selectable from a mini palette before each game
- [ ] **Pin sweep animation** — Visible mechanical sweep bar slides across the lane to clear downed pins between ball 1 and ball 2, instead of instant disappear
- [ ] **Strike/spare celebration** — Screen edge flash + brief confetti burst on strike; green ripple on spare
- [ ] **Frame transition animation** — Brief `FRAME X` banner slides in between frames before pins reset
- [ ] **Keyboard aim support** — Left/Right arrow keys move aim X while in READY state (accessibility fallback for trackpad users)
- [ ] **High score persistence** — Store top 5 scores in `globalState` (VS Code extension API) and display a leaderboard on the game-over screen

---

## Major Updates · Large Features

- [ ] **Hot-seat multiplayer (2–4 players)** — Name entry screen before game start; each player completes their full 10 frames in sequence; shared score board; winner announcement overlay with per-player final scores
- [ ] **Lane oil pattern system** — Choose from Standard, Wet/Dry, Sport, or Random oil patterns before the game; oil zones visually overlaid on the lane (translucent sheen); dry zones increase hook, oily zones reduce spin effect; adds a strategic layer to shot selection

---

## Surprise Items · Unexpected Extras

- [ ] **Replay camera** — After a strike, auto-play a 2-second replay that retraces the ball path and pin scatter using the recorded trail and pin velocity data; skippable with any key
- [ ] **Achievement system** — Unlock badges tracked in VS Code `globalState`: *Perfect Game* (300), *Turkey* (3 strikes in a row), *Hambone* (4 in a row), *First Spare*, *Clean Game* (no opens), *Gutter King* (5 gutters); badge icons flash on unlock
- [ ] **Custom pin layout editor** — Pre-throw trick shot mode where player drags pins to any position on the lane before rolling; saves as a named preset
- [ ] **Lane condition selector** — Choose Dry, Oily, Wet-Dry Combo, or Frosted (ice — ball barely hooks); each alters the spin curveFactor constant and shows a tooltip description before the game
- [ ] **Wager mode** — Before each frame, player bets 1–3 coins on their result tier (Open / Spare / Strike); start with 10 coins; coins displayed in HUD; game over shows profit/loss — adds tension to every frame
- [ ] **Trick shot challenge mode** — 10 pre-set pin arrangements (splits, corner pins, 7-10 split, etc.) presented one at a time; player has one ball per challenge; scored on percentage cleared; separate from standard game
- [ ] **Seasonal skin pack** — Halloween: pumpkin pins + dark haunted lane; Christmas: snowman pins + snow-dusted lane; toggled from a button in the HUD; purely visual swap on top of existing draw functions
- [ ] **Spin visualizer arc** — While in CHARGING state, draw a curved ghost-path on the lane showing the predicted ball trajectory including hook curve based on current aimX and accumulated horizontal drag vector; updates live as mouse moves
