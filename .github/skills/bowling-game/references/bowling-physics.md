# Bowling Physics Reference

Use these notes when implementing or tuning a bowling game. They are meant to guide game design and physics choices, not force a full sports-science simulator for every project.

## Core Constants and Useful Targets

- Ten-pin lane distance from foul line to pins: about 18.3 m (60 ft)
- Gravity on Earth: 9.8 m/s2
- Regulation bowling ball maximum mass: 16 lb (7.2 kg)
- Regulation bowling ball maximum diameter: 8.6 in (21.8 cm)
- Typical release speed for many competitive bowlers: about 17 to 19 mph
- Fast release speeds are often above 19 mph
- Balls commonly lose about 3 to 3.5 mph between release and pin impact because of friction
- One detailed physics example used about 8 m/s initial linear speed and about 30 rad/s initial angular speed as a reasonable representative shot

## Strike Geometry

- The ideal strike target is the pocket: 1-3 for a right-hander, 1-2 for a left-hander
- A strong strike often hits the headpin about 6.5 cm off center
- A useful entry-angle target is about 4 to 6 degrees
- Around 6 degrees, the strike window on the headpin gets much larger than it is at 2 to 3 degrees
- Shallow entries are more likely to leave corner pins standing because the deflection through pins 3 and 6 is weaker

## Ball Motion Phases

### Skid

- The ball initially slides while rotating
- Low friction in the oiled front lane delays full traction
- Too much skid causes weak pocket hits or missed breakpoints

### Hook

- As friction rises, the ball transitions from sliding into a curved path
- Hook strength depends on friction profile, rev rate, spin axis, coverstock, and ball design
- Games usually do not need a full rigid-body precession model to create a believable hook phase

### Roll

- In the late phase, the ball approaches pure rolling
- Translational speed and angular speed are more tightly coupled
- Late roll should feel stable rather than sharply curving at the last instant

## Oil Pattern and Friction

- Oil is commonly applied over roughly the front two-thirds of the lane
- The lane center is often more heavily oiled than the outside boards near the gutters
- More oil reduces friction, delays the transition into roll, and suppresses hook
- Drier backend boards create the traction that makes a spinning ball change direction
- For game design, model oil as a friction map with separate front-lane and backend behavior

## Hook Drivers

- Ball rotation and rev rate increase hook potential
- Axis rotation helps create the angle needed to drive through the pocket
- Reactive or rougher coverstocks grip sooner and hook more aggressively
- Smoother or less reactive surfaces skid longer and hook less
- Real bowling literature also discusses core design, moment of inertia, PAP, precession, and RG differential
- Those variables matter for high-fidelity simulation, but many games can approximate them with a smaller set of parameters such as hook potential, traction window, and backend response

## Pin Action and Carry

- A good strike is a chain reaction, not just a direct hit on all 10 pins
- A classic strike path sends the headpin into 2, then 4, then 7, while the ball continues through 3, 5, 9 and helps send 6 into 10
- Pin collisions are partly elastic and partly inelastic, so energy transfer should feel lively without becoming chaotic
- Bowling pins have a relatively low center of gravity, which makes them stable until enough torque tips them past the unstable point

## Ball Materials and Lane Read

- Modern bowling balls use different coverstocks and core designs to control friction and hook behavior
- Reactive resin tends to absorb more oil and create more hook potential
- Urethane and plastic skid more and typically react less sharply to friction changes
- Rougher finishes read the lane earlier; polished finishes push farther before turning

## Biomechanics and Animation Cues

- A common teaching model is the 4-step approach
- The backswing stores potential energy that contributes to release speed
- Timing, wrist action, and muscle coordination influence speed and rev rate
- If you are making a coaching or training mode, video-analysis style metrics such as joint angles, segment speeds, ball speed, and rev count are useful outputs
- If you are making an entertainment-first game, represent biomechanics through timing windows and animation states rather than full motion analysis

## Practical Modeling Guidance

- Start with a hybrid model before attempting a high-fidelity simulator
- Treat lane oil as a gameplay-significant friction field
- Tune for breakpoint, entry angle, and carry instead of only matching raw real-world numbers
- Expose a small number of understandable tuning variables: release speed, rev rate, axis rotation, oil length, backend friction, and pocket forgiveness
- Add visible shot feedback so players can learn why a ball skidded, hooked early, or deflected poorly

## Suggested Metrics to Surface in a Game

- Ball speed at release and at impact
- Rev rate or spin strength
- Breakpoint position
- Entry angle at the pocket
- Pocket-hit quality
- Carry efficiency or expected pinfall

## Source Links

- [Striking Physics: The Science Behind Bowling](https://illumin.usc.edu/striking-physics-the-science-behind-bowling/)
- [The perfect strike in tenpin bowling](https://physicstoday.aip.org/quick-study/the-perfect-strike-in-tenpin-bowling)
- [The Physics Of Bowling](https://www.real-world-physics-problems.com/physics-of-bowling.html)
- [Topend Sports: The Physics of Bowling](https://www.topendsports.com/sport/tenpin/physics.htm)
- [Topend Sports: Bowling Ball Speed](https://www.topendsports.com/sport/tenpin/physics-speed.htm)
- [Topend Sports: Measuring Ball Spin](https://www.topendsports.com/sport/tenpin/physics-spin.htm)
- [Topend Sports: Gravity Experiment using a bowling ball](https://www.topendsports.com/sport/tenpin/gravity-experiment.htm)
- [Topend Sports: The Biomechanics of Bowling](https://www.topendsports.com/sport/tenpin/biomechanics.htm)
- [Topend Sports: Biomechanics & Physics of Sport](https://www.topendsports.com/biomechanics/index.htm)
