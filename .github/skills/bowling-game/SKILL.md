---
name: bowling-game
description: 'Expert skill for creating, tuning, fixing, and expanding bowling games. Use when asked to build a bowling game, improve bowling ball physics, simulate hook motion or lane oil, model pin collisions, implement scoring and frame rules, add aim or release controls, or balance arcade and simulation bowling.'
---

# Bowling Game Skill

Build or improve bowling games with a sensible mix of scoring rules, controllable ball motion, believable pin action, and clear player feedback. This skill is for bowling-specific gameplay work, especially when the task involves lane behavior, hook motion, strikes and spares, or tuning the feel between arcade and simulation.

## When to Use This Skill

- Building a bowling game from scratch
- Improving bowling ball physics, hook behavior, or lane oil response
- Implementing frame scoring, strike and spare bonuses, or tenth-frame logic
- Tuning pin collisions, carry, deflection, or strike probability
- Adding aim, speed, spin, rev-rate, or release controls
- Designing approach animations, replays, shot traces, or coaching feedback
- Deciding whether the game should feel arcade-like, hybrid, or simulation-heavy

## Prerequisites

- A target stack or engine such as Three.js, Canvas, Phaser, Babylon.js, or a custom engine
- A decision on fidelity: arcade, hybrid, or simulation
- A stable lane and pin coordinate system before deep physics tuning
- The bundled notes in `references/bowling-physics.md`

## Core Design Rules

1. Build the rules and feedback loop first. A bowling game without solid frame logic and readable shot results will not be fixed by more physics.
2. Model ball motion in phases: skid, hook, and roll. That matches bowling behavior and is easier to tune than one undifferentiated force model.
3. Treat the oil pattern as a friction map, not just a visual effect.
4. Optimize for pocket entry and angle, not raw speed alone.
5. Separate player inputs into aim, speed, and rotation so difficulty can be tuned without rewriting physics.
6. Keep pin carry predictable before adding randomness, lucky messengers, or dramatic wall bounces.
7. Prefer a hybrid model unless the user explicitly wants sports-sim accuracy.

## Recommended Fidelity Levels

### Arcade

- Use a curated curve path with speed and spin modifiers
- Use forgiving pocket windows and simplified pinfall logic
- Best for casual play, gamepad-first controls, or fast iteration

### Hybrid

- Use a lane friction map and spin-driven lateral response
- Simulate the skid-to-hook-to-roll transition
- Use rigid bodies or impulse-based pin physics, with stability guards
- Best default for most bowling games

### Simulation

- Track translational velocity, angular velocity, friction, changing axis behavior, and detailed ball-lane interaction
- Use when the user explicitly wants a sports sim, coaching tool, or research-style build
- Expect more tuning time and stricter validation needs

## Step-by-Step Workflows

### 1. Build the Rules Layer First

- Implement 10 frames, strike and spare bonuses, tenth-frame bonus throws, and any foul or gutter rules needed
- Store standing pins as authoritative game state separate from render meshes
- Add stable reset, respot, and replay-safe transitions

### 2. Define Lane and Pin Geometry

- Use a consistent world origin and unit system
- Keep the foul line, aiming markers, gutters, pocket targets, and pin spots explicit in code
- Mirror logic cleanly for left- and right-handed lines

### 3. Implement Ball Release Controls

- Expose release speed, launch line, axis rotation or spin, and rev rate
- Optional advanced inputs: loft, surface type, hook bias, handedness, or release timing
- If realism is secondary, map many physical variables into a smaller set of player-friendly controls

### 4. Model Ball Motion

- Skid: low friction, low lateral movement
- Hook: friction rises and lateral response increases
- Roll: heading stabilizes and late hook tapers before impact
- Backend friction should rise near the end of the oil pattern so the ball changes direction late instead of immediately

### 5. Tune for Strike Geometry

- For a right-hander, target the 1-3 pocket; mirror to the 1-2 pocket for a left-hander
- A strong strike path usually reaches the headpin about 6.5 cm off center with roughly a 4-6 degree entry angle
- Shallower entry angles increase weak corner-pin leaves; overly steep entries can over-deflect or split

### 6. Handle Pin Action

- Use stable rigid bodies or a simplified impulse model
- Preserve a believable collision chain: headpin to 2 and 3, then through the middle and corner pins
- Keep dramatic carry as an occasional outcome, not the baseline result of every pocket hit

### 7. Add Player Feedback

- Show intended line, breakpoint, spin or rev indicator, and entry angle where useful
- Surface why a shot failed: too direct, too fast, rolled too early, missed pocket, or weak carry
- Replays and shot traces are usually more valuable than extra art polish early on

## Bowling-Specific Heuristics

- Real bowlers commonly release around 17 to 19 mph; speeds above 19 mph are fast, and the ball often loses about 3 to 3.5 mph before impact
- The lane is about 18.3 m (60 ft) from foul line to pins
- Oil usually covers roughly the front two-thirds of the lane and is often heavier in the middle than near the outside boards
- More oil means less early friction and less hook; a drier backend means more hook
- More rotation or revs and better backend traction increase entry angle and strike carry
- Rougher, more reactive surfaces read earlier; smoother surfaces skid longer

## Animation and Biomechanics Guidance

- Use a 4-step approach as the default bowler animation template
- Map backswing height and timing to release speed, not only to visuals
- Map wrist action and release timing to rev rate or axis rotation
- If full-body animation is not central to the game, fake approach biomechanics and spend the budget on release timing and ball reaction

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|--------------|-----|
| Ball never hooks | Friction map too uniform or spin has weak influence | Increase backend friction and spin-to-lateral coupling |
| Ball hooks too early | Front-lane friction too high | Extend the oil effect farther downlane |
| Too many strikes | Pocket window too large or pin carry too forgiving | Narrow the strike zone and increase deflection penalties |
| Weak hits leave corner pins constantly | Entry angle too shallow or the ball loses too much energy | Increase backend motion or preserve more drive through the pocket |
| Physics feels random | Rigid bodies are unstable | Reduce timestep, cap impulses, or hybridize with curated carry rules |
| Controls feel opaque | Too many hidden variables | Expose shot trace, breakpoint, release speed, and spin feedback |

## References

- `references/bowling-physics.md`