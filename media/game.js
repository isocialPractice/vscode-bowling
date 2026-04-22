// VS Code Bowling - Game Engine
// Inspired by World Class Bowling arcade game

(function () {
    'use strict';

    // ─── roundRect polyfill ───────────────────────────────────────────────────────
    if (!CanvasRenderingContext2D.prototype.roundRect) {
        CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
            r = Math.min(r, w / 2, h / 2);
            this.beginPath();
            this.moveTo(x + r, y);
            this.lineTo(x + w - r, y);
            this.arcTo(x + w, y, x + w, y + r, r);
            this.lineTo(x + w, y + h - r);
            this.arcTo(x + w, y + h, x + w - r, y + h, r);
            this.lineTo(x + r, y + h);
            this.arcTo(x, y + h, x, y + h - r, r);
            this.lineTo(x, y + r);
            this.arcTo(x, y, x + r, y, r);
            this.closePath();
            return this;
        };
    }

    // ─── Canvas Setup ────────────────────────────────────────────────────────────
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const W = 640, H = 760;
    canvas.width = W;
    canvas.height = H;
    canvas.style.outline = 'none';
    canvas.setAttribute('tabindex', '0');
    // Focus canvas so keyboard events work immediately (no click required)
    canvas.focus();
    setTimeout(() => canvas.focus(), 200);

    // ─── Layout Constants ────────────────────────────────────────────────────────
    const LANE_LEFT  = 160;
    const LANE_RIGHT = 480;
    const LANE_W     = LANE_RIGHT - LANE_LEFT;
    const LANE_TOP   = 40;
    const LANE_BOT   = H - 100;
    const GUTTER_W   = 30;
    const PLAY_LEFT  = LANE_LEFT + GUTTER_W;
    const PLAY_RIGHT = LANE_RIGHT - GUTTER_W;
    const PLAY_W     = PLAY_RIGHT - PLAY_LEFT;
    const BALL_R     = 16;
    const PIN_R      = 9;
    const PIN_GAP_X  = 28;   // horizontal spacing (half-gap per column offset)
    const PIN_GAP_Y  = 26;   // row spacing
    const PINS_CX    = W / 2;
    // Head pin (pin 0) is closest to bowler — highest Y in cluster
    const HEAD_PIN_Y = LANE_TOP + 130;

    // ─── States ──────────────────────────────────────────────────────────────────
    const S = {
        IDLE:      'idle',
        READY:     'ready',
        CHARGING:  'charging',
        ROLLING:   'rolling',
        SETTLING:  'settling',
        GAME_OVER: 'game_over'
    };

    // ─── Pin layout ──────────────────────────────────────────────────────────────
    // [rowFromHead, colOffset]
    // row 0 = head pin (closest to bowler, highest Y on canvas)
    // row 3 = back row (farthest, lowest Y on canvas)
    const PIN_DEF = [
        [0,  0],
        [1, -1], [1,  1],
        [2, -2], [2,  0], [2,  2],
        [3, -3], [3, -1], [3,  1], [3,  3]
    ];

    // Which pairs of pins can knock each other
    const PIN_PAIRS = [
        [0,1],[0,2],[1,3],[1,4],[2,4],[2,5],[3,6],[3,7],[4,7],[4,8],[5,8],[5,9]
    ];

    // ─── State Variables ─────────────────────────────────────────────────────────
    let state = S.IDLE;
    let pins     = [];
    let ball     = null;
    let ballPath = [];   // {x,y} canvas coords recorded each rolling frame

    // Scoring — initialize with 10 empty frames so drawScorecard works before startGame()
    let frames            = Array.from({ length: 10 }, () => ({ rolls: [], score: null }));
    let currentFrame      = 0;
    let currentBall       = 0;  // index within frame (0,1 or 0,1,2 in frame 10)
    let firstBallKnocked  = 0;  // pins knocked on ball 1 of this frame

    // Controls / aiming
    let aimX         = W / 2;
    let spaceHeld    = false;
    let power        = 0;       // 0–100
    let mHistory     = [];      // {x, y, t} mouse history while charging

    // UI helpers
    let tick         = 0;       // increments every frame (for animations)
    let flashText    = '';
    let flashColor   = '#fff';
    let flashTick    = 0;

    // ─── Pins ────────────────────────────────────────────────────────────────────
    function makePins() {
        pins = PIN_DEF.map(([row, col], i) => ({
            id:        i,
            x:         PINS_CX + col * (PIN_GAP_X / 2),
            y:         HEAD_PIN_Y - row * PIN_GAP_Y,
            vx: 0, vy: 0,
            standing:  true,
            falling:   false,
            fallAngle: 0,
            fallDir:   1
        }));
    }

    function standingCount() { return pins.filter(p => p.standing).length; }

    // ─── Scoring ─────────────────────────────────────────────────────────────────
    function computeScores() {
        let total = 0;
        for (let i = 0; i < 10; i++) {
            const f = frames[i];
            f.score = null;
            if (!f.rolls.length) continue;

            if (i < 9) {
                if (f.rolls[0] === 10) {                          // strike
                    const nx = nextRolls(i, 2);
                    if (nx.length < 2) continue;
                    f.score = total + 10 + nx[0] + nx[1];
                } else if (f.rolls.length >= 2 && f.rolls[0] + f.rolls[1] === 10) { // spare
                    const nx = nextRolls(i, 1);
                    if (nx.length < 1) continue;
                    f.score = total + 10 + nx[0];
                } else if (f.rolls.length >= 2) {
                    f.score = total + f.rolls[0] + f.rolls[1];
                } else continue;
            } else {                                              // 10th
                if (f.rolls.length < 2) continue;
                const needsThree = f.rolls[0] === 10 || f.rolls[0] + f.rolls[1] === 10;
                if (needsThree && f.rolls.length < 3) continue;
                f.score = total + f.rolls.reduce((a, b) => a + b, 0);
            }
            total = f.score;
        }
    }

    function nextRolls(fi, count) {
        const out = [];
        for (let i = fi + 1; i < 10 && out.length < count; i++) {
            for (const r of frames[i].rolls) {
                out.push(r);
                if (out.length >= count) break;
            }
        }
        return out;
    }

    // ─── Game Init ───────────────────────────────────────────────────────────────
    function startGame() {
        frames       = Array.from({ length: 10 }, () => ({ rolls: [], score: null }));
        currentFrame = 0;
        currentBall  = 0;
        firstBallKnocked = 0;
        aimX         = W / 2;
        power        = 0;
        spaceHeld    = false;
        mHistory     = [];
        ball         = null;
        makePins();
        state = S.READY;
        canvas.focus();
    }

    // ─── Throw ───────────────────────────────────────────────────────────────────
    function throwBall(speed, dirBias, spin) {
        ballPath = [];
        ball = {
            x: aimX,
            y: LANE_BOT - BALL_R - 8,
            vx: dirBias,
            vy: -Math.max(speed, 4),
            spin,
            inGutter: false,
            trail: []
        };
        spaceHeld = false;
        power     = 0;
        mHistory  = [];
        state     = S.ROLLING;
    }

    // ─── Physics ─────────────────────────────────────────────────────────────────
    function updateBall() {
        if (!ball) return;

        ball.trail.push({ x: ball.x, y: ball.y });
        if (ball.trail.length > 22) ball.trail.shift();
        ballPath.push({ x: ball.x, y: ball.y });

        ball.vx += ball.spin * 0.035;  // hook effect accumulates
        ball.x  += ball.vx;
        ball.y  += ball.vy;

        // Gutter walls
        if (ball.x - BALL_R < PLAY_LEFT) {
            ball.x = PLAY_LEFT + BALL_R;
            ball.vx = Math.abs(ball.vx) * 0.15;
            ball.inGutter = true;
        } else if (ball.x + BALL_R > PLAY_RIGHT) {
            ball.x = PLAY_RIGHT - BALL_R;
            ball.vx = -Math.abs(ball.vx) * 0.15;
            ball.inGutter = true;
        }

        // Pin collisions
        if (!ball.inGutter) {
            for (const pin of pins) {
                if (!pin.standing) continue;
                const dx = ball.x - pin.x;
                const dy = ball.y - pin.y;
                if (Math.hypot(dx, dy) < BALL_R + PIN_R + 1) {
                    knockPin(pin);
                    ball.vx *= 0.87;
                    ball.vy *= 0.93;
                }
            }
        }

        // Ball leaves the lane
        if (ball.y + BALL_R < LANE_TOP || (ball.inGutter && ball.y < HEAD_PIN_Y - 30)) {
            endRoll();
        }
    }

    function knockPin(pin) {
        if (!pin.standing) return;
        pin.standing  = false;
        pin.falling   = true;
        pin.fallAngle = 0;
        const dx  = pin.x - ball.x;
        const dy  = pin.y - ball.y;
        const len = Math.hypot(dx, dy) || 1;
        pin.vx    = (dx / len) * 3.2 + ball.vx * 0.5 + ball.spin * 0.6;
        pin.vy    = (dy / len) * 2.2 + ball.vy * 0.28;
        pin.fallDir = pin.vx >= 0 ? 1 : -1;
        setTimeout(() => chainReact(pin), 90);
    }

    function chainReact(moved) {
        for (const [a, b] of PIN_PAIRS) {
            const other = moved.id === a ? pins[b] : moved.id === b ? pins[a] : null;
            if (!other || !other.standing) continue;
            if (Math.hypot(moved.x - other.x, moved.y - other.y) < PIN_R * 3.0) {
                other.standing  = false;
                other.falling   = true;
                other.fallAngle = 0;
                other.fallDir   = moved.vx >= 0 ? 1 : -1;
                other.vx        = moved.vx * 0.55;
                other.vy        = moved.vy * 0.55;
                setTimeout(() => chainReact(other), 80);
            }
        }
    }

    function updatePins() {
        for (const p of pins) {
            if (!p.falling) continue;
            p.x  += p.vx * 0.55;
            p.y  += p.vy * 0.55;
            p.vx *= 0.92;
            p.vy *= 0.92;
            p.fallAngle += p.fallDir * 5;
            if (Math.abs(p.fallAngle) >= 90) {
                p.fallAngle = 90 * p.fallDir;
                p.falling   = false;
            }
        }
    }

    // ─── Roll Outcome ────────────────────────────────────────────────────────────
    function endRoll() {
        if (state !== S.ROLLING) return;
        state = S.SETTLING;
        // Capture ball info before nulling — needed for animation
        const gutterSide = (ball && ball.inGutter) ? (ball.x < W / 2 ? 'left' : 'right') : null;
        ball  = null;

        const totalKnocked = 10 - standingCount();
        const thisRoll = currentBall === 0 ? totalKnocked : totalKnocked - firstBallKnocked;

        // Flash result
        if (thisRoll === 10 && currentBall === 0) {
            flash('STRIKE!', '#ffaa00');
        } else if (currentBall > 0 && totalKnocked === 10) {
            flash('SPARE!', '#44ff88');
        } else if (thisRoll > 0) {
            flash(thisRoll + (thisRoll === 1 ? ' pin' : ' pins'), '#ffffff');
        } else {
            flash('Gutter!', '#ff5555');
        }

        frames[currentFrame].rolls.push(thisRoll);
        computeScores();

        // Play animation on strike or second ball completion
        const isStrike = (currentBall === 0 && thisRoll === 10);
        const isSecondBall = (currentBall === 1 && currentFrame < 9);
        const shouldAnimate = isStrike || isSecondBall;

        if (shouldAnimate) {
            // Capture which pins were standing before this roll and which fell this roll.
            // p.swept = true means the pin was knocked in a prior ball of this frame.
            const animPinState = {
                standingBefore:  pins.filter(p => !p.swept).map(p => p.id),
                knockedThisRoll: pins.filter(p => !p.standing && !p.swept).map(p => p.id),
                ballPath:        ballPath.slice(),
                gutterSide
            };
            startBowlingAnimation(animPinState);
        }
        const settleDur = (shouldAnimate && bowlingAnim) ? 3500 : 1400;
        setTimeout(() => advance(totalKnocked), settleDur);
    }

    function advance(totalKnocked) {
        const f     = frames[currentFrame];
        const rolls = f.rolls;

        if (currentFrame < 9) {
            if (currentBall === 0 && rolls[0] === 10) {
                nextFrame();                   // strike → next frame
            } else if (currentBall === 0) {
                firstBallKnocked = totalKnocked;
                currentBall = 1;
                for (const p of pins) if (!p.standing) p.swept = true;
                state = S.READY;
            } else {
                nextFrame();                   // second ball done
            }
        } else {
            // ── 10th frame ────────────────────────────────────────────────────
            if (rolls.length === 1) {
                if (rolls[0] === 10) { makePins(); firstBallKnocked = 0; }
                else                 { firstBallKnocked = rolls[0]; for (const p of pins) if (!p.standing) p.swept = true; }
                currentBall = 1;
                state = S.READY;

            } else if (rolls.length === 2) {
                const isStrike = rolls[0] === 10;
                const isSpare  = !isStrike && (rolls[0] + rolls[1] === 10);
                if (isStrike || isSpare) {
                    // Bonus ball
                    if (isStrike && rolls[1] === 10) { makePins(); firstBallKnocked = 0; }
                    else if (isStrike)               { firstBallKnocked = rolls[1]; for (const p of pins) if (!p.standing) p.swept = true; }
                    else                             { makePins(); firstBallKnocked = 0; }
                    currentBall = 2;
                    state = S.READY;
                } else {
                    state = S.GAME_OVER;
                }

            } else {
                state = S.GAME_OVER;
            }
        }
    }

    function nextFrame() {
        if (currentFrame >= 9) { state = S.GAME_OVER; return; }
        currentFrame++;
        currentBall      = 0;
        firstBallKnocked = 0;
        aimX             = W / 2;
        makePins();
        state = S.READY;
    }

    // ─── Flash Message ───────────────────────────────────────────────────────────
    function flash(text, color) {
        flashText  = text;
        flashColor = color || '#fff';
        flashTick  = 90;
    }

    // ─── Keyboard Input ──────────────────────────────────────────────────────────
    // Listen on WINDOW (not document) — most reliable in VS Code WebView
    window.addEventListener('keydown', (e) => {
        switch (e.code) {
            case 'Space':
                e.preventDefault();
                if (state === S.READY && !spaceHeld) {
                    spaceHeld = true;
                    power     = 0;
                    mHistory  = [];
                    state     = S.CHARGING;
                }
                break;

            case 'Enter':
            case 'NumpadEnter':
                e.preventDefault();
                if (state === S.IDLE || state === S.GAME_OVER) startGame();
                break;

            case 'Escape':
                if (state === S.CHARGING) {
                    spaceHeld = false;
                    power     = 0;
                    mHistory  = [];
                    state     = S.READY;
                }
                break;
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            spaceHeld = false;
            if (state === S.CHARGING) {
                power    = 0;
                mHistory = [];
                state    = S.READY;
            }
        }
    });

    // ─── Mouse Input ─────────────────────────────────────────────────────────────
    // Click: focus canvas + start game
    canvas.addEventListener('click', () => {
        canvas.focus();
        if (state === S.IDLE || state === S.GAME_OVER) startGame();
    });

    // Track mouse on WINDOW so dragging outside canvas still registers
    window.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const sx   = W / rect.width;
        const sy   = H / rect.height;
        const mx   = (e.clientX - rect.left) * sx;
        const my   = (e.clientY - rect.top)  * sy;

        // ── Aiming (move ball L/R) ────────────────────────────────────────────
        if (state === S.READY) {
            aimX = Math.max(PLAY_LEFT  + BALL_R + 4,
                   Math.min(PLAY_RIGHT - BALL_R - 4, mx));
        }

        if (state !== S.CHARGING) return;

        // ── Power charging ────────────────────────────────────────────────────
        const prev = mHistory[mHistory.length - 1];
        mHistory.push({ x: mx, y: my, t: performance.now() });
        if (mHistory.length > 30) mHistory.shift();
        if (!prev) return;

        const dy = my - prev.y;

        // Downward drag → accumulate power
        if (dy > 0) {
            power = Math.min(power + dy * 0.95, 100);
        }

        // ── Throw detection: upward flick ─────────────────────────────────────
        if (dy < -4 && power > 2 && mHistory.length >= 3) {
            // Average velocity of last 8 samples
            const recent = mHistory.slice(-8);
            let tdx = 0, tdy = 0;
            for (let i = 1; i < recent.length; i++) {
                tdx += recent[i].x - recent[i - 1].x;
                tdy += recent[i].y - recent[i - 1].y;
            }
            const n    = recent.length - 1 || 1;
            const avgDy = tdy / n;   // negative = upward
            const avgDx = tdx / n;

            const upSpeed   = Math.abs(Math.min(avgDy, 0));
            const pFactor   = power / 100;
            const speed     = Math.min(4 + upSpeed * 0.7 * pFactor * 11, 17);
            const dirBias   = avgDx * 0.11;
            const spin      = avgDx * 0.055;

            throwBall(speed, dirBias, spin);
        }
    });

    // ─── Rendering ───────────────────────────────────────────────────────────────
    function drawLane() {
        // Background
        ctx.fillStyle = '#0f1421';
        ctx.fillRect(0, 0, W, H);

        // Lane wood
        const lg = ctx.createLinearGradient(LANE_LEFT, 0, LANE_RIGHT, 0);
        lg.addColorStop(0,    '#b08030');
        lg.addColorStop(0.12, '#cc9c44');
        lg.addColorStop(0.5,  '#e0b858');
        lg.addColorStop(0.88, '#cc9c44');
        lg.addColorStop(1,    '#b08030');
        ctx.fillStyle = lg;
        ctx.fillRect(LANE_LEFT, LANE_TOP, LANE_W, LANE_BOT - LANE_TOP);

        // Wood grain
        ctx.strokeStyle = 'rgba(130,85,25,0.18)';
        ctx.lineWidth = 1;
        for (let x = LANE_LEFT + 15; x < LANE_RIGHT; x += 15) {
            ctx.beginPath();
            ctx.moveTo(x, LANE_TOP);
            ctx.lineTo(x, LANE_BOT);
            ctx.stroke();
        }

        // Gutters
        ctx.fillStyle = '#1e1206';
        ctx.fillRect(LANE_LEFT,          LANE_TOP, GUTTER_W,   LANE_BOT - LANE_TOP);
        ctx.fillRect(LANE_RIGHT-GUTTER_W, LANE_TOP, GUTTER_W,   LANE_BOT - LANE_TOP);

        ctx.strokeStyle = '#4a3010';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(PLAY_LEFT,  LANE_TOP); ctx.lineTo(PLAY_LEFT,  LANE_BOT);
        ctx.moveTo(PLAY_RIGHT, LANE_TOP); ctx.lineTo(PLAY_RIGHT, LANE_BOT);
        ctx.stroke();

        // Approach arrows (7)
        const arrowY = LANE_TOP + 155;
        for (let n = -3; n <= 3; n++) {
            const ax = PINS_CX + n * (PLAY_W / 7.5);
            if (ax < PLAY_LEFT + 6 || ax > PLAY_RIGHT - 6) continue;
            ctx.fillStyle = n === 0 ? 'rgba(200,60,60,0.6)' : 'rgba(140,90,30,0.5)';
            ctx.beginPath();
            ctx.moveTo(ax, arrowY - 11);
            ctx.lineTo(ax - 6, arrowY + 5);
            ctx.lineTo(ax, arrowY - 1);
            ctx.lineTo(ax + 6, arrowY + 5);
            ctx.closePath();
            ctx.fill();
        }

        // Dots
        ctx.fillStyle = 'rgba(130,85,25,0.65)';
        for (let n = -3; n <= 3; n++) {
            const dx = PINS_CX + n * (PLAY_W / 7.5);
            if (dx < PLAY_LEFT || dx > PLAY_RIGHT) continue;
            ctx.beginPath();
            ctx.arc(dx, LANE_BOT - 85, 3.5, 0, Math.PI * 2);
            ctx.fill();
        }

        // Foul line
        ctx.strokeStyle = '#cc2222';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(PLAY_LEFT, LANE_BOT - 60);
        ctx.lineTo(PLAY_RIGHT, LANE_BOT - 60);
        ctx.stroke();
        ctx.fillStyle = 'rgba(200,40,40,0.1)';
        ctx.fillRect(PLAY_LEFT, LANE_BOT - 60, PLAY_W, 60);

        // Border
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 2;
        ctx.strokeRect(LANE_LEFT, LANE_TOP, LANE_W, LANE_BOT - LANE_TOP);
    }

    function drawPin(pin) {
        if (pin.swept) return;
        ctx.save();
        ctx.translate(pin.x, pin.y);
        if (!pin.standing) ctx.rotate(pin.fallAngle * Math.PI / 180);

        // Shadow
        if (pin.standing) {
            ctx.beginPath();
            ctx.ellipse(3, 4, PIN_R * 0.85, PIN_R * 0.4, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fill();
        }

        // Body
        const pg = ctx.createRadialGradient(-PIN_R * 0.3, -PIN_R * 0.3, PIN_R * 0.08, 0, 0, PIN_R);
        pg.addColorStop(0,   '#ffffff');
        pg.addColorStop(0.5, '#eeece8');
        pg.addColorStop(0.8, '#d8d0c8');
        pg.addColorStop(1,   '#c0b8b0');
        ctx.beginPath();
        ctx.arc(0, 0, PIN_R, 0, Math.PI * 2);
        ctx.fillStyle = pg;
        ctx.fill();

        // Red outer ring
        ctx.beginPath();
        ctx.arc(0, 0, PIN_R, 0, Math.PI * 2);
        ctx.strokeStyle = '#cc1111';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Red neck ring
        ctx.beginPath();
        ctx.arc(0, 0, PIN_R * 0.5, 0, Math.PI * 2);
        ctx.strokeStyle = '#cc1111';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.restore();
    }

    let rollAngle = 0;

    function drawBallShape(x, y, angle, alpha) {
        ctx.save();
        if (alpha != null) ctx.globalAlpha = alpha;

        // Shadow
        ctx.beginPath();
        ctx.ellipse(x + 4, y + 6, BALL_R * 0.78, BALL_R * 0.42, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fill();

        // Body
        const bg = ctx.createRadialGradient(x - BALL_R * 0.35, y - BALL_R * 0.35, BALL_R * 0.05, x, y, BALL_R);
        bg.addColorStop(0,    '#5577dd');
        bg.addColorStop(0.3,  '#2244bb');
        bg.addColorStop(0.65, '#111144');
        bg.addColorStop(1,    '#000022');
        ctx.beginPath();
        ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
        ctx.fillStyle = bg;
        ctx.fill();

        // Specular
        ctx.beginPath();
        ctx.ellipse(x - BALL_R * 0.32, y - BALL_R * 0.32, BALL_R * 0.28, BALL_R * 0.17, -Math.PI / 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.52)';
        ctx.fill();

        // Finger holes
        ctx.translate(x, y);
        ctx.rotate(angle * Math.PI / 180);
        for (const [hx, hy] of [
            [BALL_R * 0.2, -BALL_R * 0.5],
            [-BALL_R * 0.34, -BALL_R * 0.27],
            [BALL_R * 0.08, -BALL_R * 0.08]
        ]) {
            ctx.beginPath();
            ctx.arc(hx, hy, BALL_R * 0.13, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fill();
        }

        ctx.restore();
    }

    function drawBall() {
        if (ball) {
            // Trail
            for (let i = 0; i < ball.trail.length; i++) {
                const t = i / ball.trail.length;
                ctx.beginPath();
                ctx.arc(ball.trail[i].x, ball.trail[i].y, Math.max(BALL_R * t * 0.65, 2), 0, Math.PI * 2);
                ctx.fillStyle = `rgba(40,80,220,${t * 0.2})`;
                ctx.fill();
            }
            rollAngle = (rollAngle + 8) % 360;
            drawBallShape(ball.x, ball.y, rollAngle);
        } else if (state === S.READY || state === S.CHARGING) {
            const bx = aimX;
            const by = LANE_BOT - BALL_R - 16;

            // Glow ring — indicates state
            const pulse = (Math.sin(tick * 0.1) + 1) / 2;
            if (state === S.READY) {
                // Soft blue pulse — "ready to aim"
                ctx.beginPath();
                ctx.arc(bx, by, BALL_R + 7, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(80,180,255,${0.25 + pulse * 0.55})`;
                ctx.lineWidth = 2.5;
                ctx.stroke();
            } else {
                // Bright orange — "charging"
                const size = BALL_R + 7 + (power / 100) * 6;
                ctx.beginPath();
                ctx.arc(bx, by, size, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(255,150,0,${0.6 + pulse * 0.4})`;
                ctx.lineWidth = 3;
                ctx.stroke();
            }

            rollAngle = (rollAngle + 1) % 360;
            drawBallShape(bx, by, rollAngle);
        }
    }

    function drawAimGuide() {
        if (state !== S.READY && state !== S.CHARGING) return;
        const bx = aimX;
        const by = LANE_BOT - BALL_R - 16;
        ctx.save();
        ctx.setLineDash([5, 9]);
        ctx.strokeStyle = 'rgba(255,255,160,0.28)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(bx, by - BALL_R);
        ctx.lineTo(PINS_CX + (bx - PINS_CX) * 0.08, HEAD_PIN_Y + 16);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }

    // ─── State Indicators ────────────────────────────────────────────────────────
    function drawReadyIndicator() {
        if (state !== S.READY) return;
        const bx = aimX;
        const by = LANE_BOT - BALL_R - 16;
        const pulse = (Math.sin(tick * 0.09) + 1) / 2;

        // Aim arrows (L/R)
        ctx.font = '18px monospace';
        ctx.textAlign = 'center';
        if (bx > PLAY_LEFT + 35) {
            ctx.fillStyle = `rgba(100,170,255,${0.4 + pulse * 0.4})`;
            ctx.fillText('◄', bx - BALL_R - 14, by + 5);
        }
        if (bx < PLAY_RIGHT - 35) {
            ctx.fillStyle = `rgba(100,170,255,${0.4 + pulse * 0.4})`;
            ctx.fillText('►', bx + BALL_R + 12, by + 5);
        }

        // "HOLD SPACE" badge below ball
        const label = 'HOLD [SPACE] to charge';
        ctx.font = 'bold 12px monospace';
        const lw = ctx.measureText(label).width;
        ctx.fillStyle = `rgba(0,0,0,${0.6 + pulse * 0.2})`;
        ctx.beginPath();
        ctx.roundRect(bx - lw/2 - 8, by + BALL_R + 8, lw + 16, 22, 5);
        ctx.fill();
        ctx.fillStyle = `rgba(255,220,50,${0.8 + pulse * 0.2})`;
        ctx.fillText(label, bx, by + BALL_R + 24);
    }

    function drawChargingIndicator() {
        if (state !== S.CHARGING) return;
        const bx = aimX;
        const by = LANE_BOT - BALL_R - 16;
        const pulse = (Math.sin(tick * 0.12) + 1) / 2;

        // Power meter (left side)
        const mx = 36, my = H / 2 - 10;
        const mw = 22, mh = 190;

        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        ctx.beginPath();
        ctx.roundRect(mx - mw/2 - 7, my - mh/2 - 32, mw + 14, mh + 56, 8);
        ctx.fill();

        ctx.fillStyle = '#ffdd44';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('PWR', mx, my - mh/2 - 14);

        // Track
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(mx - mw/2, my - mh/2, mw, mh);

        // Fill
        const fh = (power / 100) * mh;
        const fy = my + mh/2 - fh;
        const pg = ctx.createLinearGradient(0, fy, 0, fy + fh);
        pg.addColorStop(0,   power > 70 ? '#ff3333' : '#ffaa00');
        pg.addColorStop(0.4, '#ffcc22');
        pg.addColorStop(1,   '#33ff66');
        ctx.fillStyle = pg;
        ctx.fillRect(mx - mw/2, fy, mw, fh);

        // Ticks
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const ty = my - mh/2 + i * (mh/4);
            ctx.beginPath();
            ctx.moveTo(mx - mw/2 - 3, ty);
            ctx.lineTo(mx - mw/2, ty);
            ctx.stroke();
        }

        // Border
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(mx - mw/2, my - mh/2, mw, mh);

        // Percent
        ctx.fillStyle = power > 70 ? '#ff7777' : '#cccccc';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(Math.round(power) + '%', mx, my + mh/2 + 18);

        // Drag-down arrow (animated bounce)
        const bounce = Math.sin(tick * 0.12) * 5;
        ctx.fillStyle = `rgba(255,200,50,${0.7 + pulse * 0.3})`;
        ctx.font = '22px monospace';
        ctx.fillText('▼', mx, my + mh/2 + 36 + bounce);
        ctx.font = '9px monospace';
        ctx.fillStyle = '#999';
        ctx.fillText('DRAG', mx, my + mh/2 + 52);
        ctx.fillText('DOWN', mx, my + mh/2 + 63);

        // SPACE held badge (top-right of ball)
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.beginPath();
        ctx.roundRect(bx + BALL_R + 6, by - 10, 98, 18, 4);
        ctx.fill();
        ctx.fillStyle = '#44ff88';
        ctx.fillText('SPACE held ✓', bx + BALL_R + 10, by + 3);

        // "Flick up to throw" badge (only shown when power > 10)
        if (power > 10) {
            const label = '▲ Flick UP to throw!';
            ctx.font = 'bold 12px monospace';
            const lw = ctx.measureText(label).width;
            ctx.textAlign = 'center';
            ctx.fillStyle = `rgba(0,0,0,${0.6 + pulse * 0.2})`;
            ctx.beginPath();
            ctx.roundRect(bx - lw/2 - 8, by - BALL_R - 32, lw + 16, 22, 5);
            ctx.fill();
            ctx.fillStyle = `rgba(255,220,50,${0.8 + pulse * 0.2})`;
            ctx.fillText(label, bx, by - BALL_R - 16);
        }
    }

    function drawStartScreen() {
        if (state !== S.IDLE && state !== S.GAME_OVER) return;
        const cx = (PLAY_LEFT + PLAY_RIGHT) / 2;
        const cy = LANE_TOP + (LANE_BOT - LANE_TOP) * 0.45;
        const pulse = (Math.sin(tick * 0.07) + 1) / 2;

        // Card
        ctx.fillStyle = 'rgba(0,0,0,0.78)';
        ctx.beginPath();
        ctx.roundRect(cx - 165, cy - 90, 330, 185, 14);
        ctx.fill();

        if (state === S.IDLE) {
            ctx.fillStyle = '#ffdd44';
            ctx.font = 'bold 50px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('BOWLING', cx, cy - 22);
        } else {
            const score = frames[9]?.score ?? 0;
            ctx.fillStyle = '#ff8844';
            ctx.font = 'bold 36px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('GAME OVER', cx, cy - 36);
            ctx.fillStyle = '#ffffff';
            ctx.font = '22px monospace';
            ctx.fillText('Score: ' + score, cx, cy - 4);
            if (score === 300) {
                ctx.fillStyle = '#ffdd44';
                ctx.font = 'bold 18px monospace';
                ctx.fillText('PERFECT GAME!', cx, cy + 22);
            }
        }

        // "Click or Enter" button — pulsing
        const btnY = cy + (state === S.IDLE ? 28 : 50);
        ctx.fillStyle = `rgba(40,160,80,${0.55 + pulse * 0.45})`;
        ctx.beginPath();
        ctx.roundRect(cx - 130, btnY, 260, 36, 8);
        ctx.fill();
        ctx.strokeStyle = `rgba(80,255,120,${0.4 + pulse * 0.5})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(cx - 130, btnY, 260, 36, 8);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('CLICK HERE  or  Press ENTER', cx, btnY + 24);
    }

    function drawFlash() {
        if (flashTick <= 0) return;
        flashTick--;
        const alpha = Math.min(flashTick / 25, 1);
        const scale = 1 + (1 - Math.min(flashTick / 75, 1)) * 0.25;
        const cx = (PLAY_LEFT + PLAY_RIGHT) / 2;
        const cy = LANE_TOP + (LANE_BOT - LANE_TOP) * 0.4;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.fillStyle = flashColor;
        ctx.shadowColor = flashColor;
        ctx.shadowBlur = 24;
        ctx.font = 'bold 44px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(flashText, 0, 0);
        ctx.restore();
    }

    // ─── HUD (right panel) ───────────────────────────────────────────────────────
    function drawHUD() {
        const px = LANE_RIGHT + 10;
        const pw = W - LANE_RIGHT - 14;
        const py = LANE_TOP;

        // ── Frame / Ball / Score card ─────────────────────────────────────────
        ctx.fillStyle = 'rgba(8,12,22,0.88)';
        ctx.beginPath();
        ctx.roundRect(px, py, pw, 210, 8);
        ctx.fill();

        ctx.fillStyle = '#aaddff';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('FRAME', px + pw/2, py + 18);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 40px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(String(currentFrame + 1), px + pw/2, py + 60);

        ctx.fillStyle = '#88aacc';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('BALL ' + (currentBall + 1), px + pw/2, py + 80);

        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px + 8, py + 91); ctx.lineTo(px + pw - 8, py + 91);
        ctx.stroke();

        // Running score
        let runScore = 0;
        for (let i = currentFrame; i >= 0; i--) {
            if (frames[i].score !== null) { runScore = frames[i].score; break; }
        }
        ctx.fillStyle = '#ffdd88';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('SCORE', px + pw/2, py + 108);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 26px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(String(runScore), px + pw/2, py + 136);

        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.moveTo(px + 8, py + 146); ctx.lineTo(px + pw - 8, py + 146);
        ctx.stroke();

        // State-specific control hints
        const hints = stateHints();
        hints.forEach((h, i) => {
            ctx.fillStyle = h.color || '#777';
            ctx.font = (h.bold ? 'bold ' : '') + '10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(h.text, px + pw/2, py + 162 + i * 13);
        });
    }

    function stateHints() {
        switch (state) {
            case S.IDLE:
            case S.GAME_OVER:
                return [
                    { text: 'CLICK or ENTER', color: '#44ff88', bold: true },
                    { text: 'to start', color: '#888' }
                ];
            case S.READY:
                return [
                    { text: '← Mouse →', color: '#88ccff', bold: true },
                    { text: 'Aim ball', color: '#888' },
                    { text: '' },
                    { text: '[SPACE]', color: '#ffdd44', bold: true },
                    { text: 'Hold to charge', color: '#888' }
                ];
            case S.CHARGING:
                return [
                    { text: 'SPACE held ✓', color: '#44ff88', bold: true },
                    { text: '' },
                    { text: '▼ Drag DOWN', color: '#ffaa00', bold: true },
                    { text: 'Power = ' + Math.round(power) + '%', color: power > 0 ? '#ffaa00' : '#888' },
                    { text: '' },
                    { text: '▲ Flick UP', color: '#ffdd44', bold: true },
                    { text: 'to throw', color: '#888' }
                ];
            case S.ROLLING:
                return [{ text: 'Rolling...', color: '#88bbff' }];
            case S.SETTLING:
                return [{ text: 'Get ready...', color: '#777' }];
            default:
                return [];
        }
    }

    // ─── Scorecard ───────────────────────────────────────────────────────────────
    function drawScorecard() {
        const sx = 8, sy = H - 88, sw = W - 16, sh = 80;

        ctx.fillStyle = 'rgba(6,9,18,0.9)';
        ctx.beginPath();
        ctx.roundRect(sx, sy, sw, sh, 6);
        ctx.fill();

        const fw = sw / 10;
        for (let i = 0; i < 10; i++) {
            const fx    = sx + i * fw;
            const frame = frames[i];
            const active = (i === currentFrame) && (state !== S.GAME_OVER);

            if (active) {
                ctx.fillStyle = 'rgba(40,80,200,0.38)';
                ctx.fillRect(fx + 1, sy + 1, fw - 2, sh - 2);
            }

            ctx.strokeStyle = active ? 'rgba(80,140,255,0.9)' : 'rgba(255,255,255,0.18)';
            ctx.lineWidth   = active ? 1.5 : 0.7;
            ctx.strokeRect(fx, sy, fw, sh);

            // Frame number
            ctx.fillStyle   = active ? '#88bbff' : '#555';
            ctx.font        = '9px monospace';
            ctx.textAlign   = 'center';
            ctx.fillText(String(i + 1), fx + fw/2, sy + 12);

            // Rolls
            const rolls = frame.rolls;
            if (i < 9) {
                const hw = fw / 2;
                for (let r = 0; r < 2; r++) {
                    if (rolls[r] === undefined) continue;
                    let lbl = '';
                    if (r === 0 && rolls[r] === 10)                lbl = 'X';
                    else if (r === 1 && rolls[0]+rolls[1] === 10)  lbl = '/';
                    else lbl = rolls[r] === 0 ? '-' : String(rolls[r]);
                    ctx.fillStyle = lbl === 'X' ? '#ff8833' : lbl === '/' ? '#44ff77' : '#eee';
                    ctx.font = 'bold ' + (lbl === 'X' || lbl === '/' ? 14 : 13) + 'px monospace';
                    ctx.fillText(lbl, fx + hw * r + hw/2, sy + 37);
                }
                ctx.strokeStyle = 'rgba(255,255,255,0.15)';
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(fx + fw/2, sy + 16); ctx.lineTo(fx + fw/2, sy + 44);
                ctx.stroke();
            } else {
                const tw = fw / 3;
                for (let r = 0; r < 3; r++) {
                    if (rolls[r] === undefined) continue;
                    let lbl = '';
                    if (rolls[r] === 10)                                  lbl = 'X';
                    else if (r > 0 && rolls[r-1] !== 10 && rolls[r-1]+rolls[r] === 10) lbl = '/';
                    else lbl = rolls[r] === 0 ? '-' : String(rolls[r]);
                    ctx.fillStyle = lbl === 'X' ? '#ff8833' : lbl === '/' ? '#44ff77' : '#eee';
                    ctx.font = 'bold 11px monospace';
                    ctx.fillText(lbl, fx + tw * r + tw/2, sy + 37);
                }
                ctx.strokeStyle = 'rgba(255,255,255,0.15)';
                ctx.lineWidth = 0.8;
                for (let r = 0; r < 2; r++) {
                    ctx.beginPath();
                    ctx.moveTo(fx + tw*(r+1), sy+16); ctx.lineTo(fx + tw*(r+1), sy+44);
                    ctx.stroke();
                }
            }

            // Score
            if (frame.score !== null) {
                ctx.fillStyle = '#ddd';
                ctx.font = 'bold 13px monospace';
                ctx.textAlign = 'center';
                ctx.fillText(String(frame.score), fx + fw/2, sy + 67);
            }
        }
    }

    // ─── Game Loop ────────────────────────────────────────────────────────────────
    function loop() {
        tick++;
        ctx.clearRect(0, 0, W, H);

        drawLane();
        drawAimGuide();
        for (const pin of pins) drawPin(pin);
        drawBall();
        drawChargingIndicator();
        drawReadyIndicator();
        drawFlash();
        drawScorecard();
        drawHUD();
        drawBowlingAnimation();
        drawStartScreen();

        if (state === S.ROLLING)  updateBall();
        updatePins();

        requestAnimationFrame(loop);
    }

    // ─── Three.js Bowling Animation ──────────────────────────────────────────────
    let THREE = null;
    let threeScene = null;
    let threeCamera = null;
    let threeRenderer = null;
    let threeBall = null;
    let threePinObjects = [];
    let bowlingAnim = null;
    let threeContainer = null;
    let isThreeReady = false;
    let pinGeometry = null;
    let pinMaterial = null;

    // Pin formation positions (X, Z) - Y is up
    const PIN_POSITIONS = [
        [0, -4],           // Head pin
        [-0.3, -4.5], [0.3, -4.5],
        [-0.6, -5], [0, -5], [0.6, -5],
        [-0.9, -5.5], [-0.3, -5.5], [0.3, -5.5], [0.9, -5.5]
    ];

    function initThreeJS() {
        try {
            THREE = window.THREE;
            if (!THREE) {
                console.warn('Three.js not available');
                return;
            }

            threeContainer = document.getElementById('threejs-container');
            if (!threeContainer) {
                console.warn('Three.js container not found');
                return;
            }

            // Scene
            threeScene = new THREE.Scene();
            threeScene.fog = new THREE.Fog(0x000000, 8, 20);

            // Camera
            threeCamera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
            threeCamera.position.set(0, 2.5, 6);
            threeCamera.lookAt(0, 0, -2);

            // Renderer
            threeRenderer = new THREE.WebGLRenderer({ 
                alpha: true, 
                antialias: true 
            });
            threeRenderer.setSize(W, H);
            threeRenderer.shadowMap.enabled = true;
            threeRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
            threeRenderer.setClearColor(0x000000, 0);
            threeContainer.appendChild(threeRenderer.domElement);

            // Lights
            const ambient = new THREE.AmbientLight(0xffffff, 0.5);
            threeScene.add(ambient);

            const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
            mainLight.position.set(2, 8, 1);
            mainLight.castShadow = true;
            mainLight.shadow.mapSize.width = 2048;
            mainLight.shadow.mapSize.height = 2048;
            mainLight.shadow.camera.near = 0.5;
            mainLight.shadow.camera.far = 50;
            mainLight.shadow.camera.left = -5;
            mainLight.shadow.camera.right = 5;
            mainLight.shadow.camera.top = 5;
            mainLight.shadow.camera.bottom = -8;
            threeScene.add(mainLight);

            const fillLight = new THREE.DirectionalLight(0x8899ff, 0.3);
            fillLight.position.set(-3, 3, 2);
            threeScene.add(fillLight);

            // Bowling lane
            const laneGeo = new THREE.PlaneGeometry(2.5, 12);
            const laneMat = new THREE.MeshStandardMaterial({
                color: 0xb8885a,
                roughness: 0.8,
                metalness: 0.1
            });
            const lane = new THREE.Mesh(laneGeo, laneMat);
            lane.rotation.x = -Math.PI / 2;
            lane.position.y = 0;
            lane.receiveShadow = true;
            threeScene.add(lane);

            // Gutters
            const gutterGeo = new THREE.PlaneGeometry(0.3, 12);
            const gutterMat = new THREE.MeshStandardMaterial({
                color: 0x222222,
                roughness: 0.9
            });
            const gutterL = new THREE.Mesh(gutterGeo, gutterMat);
            gutterL.rotation.x = -Math.PI / 2;
            gutterL.position.set(-1.4, -0.05, 0);
            threeScene.add(gutterL);
            
            const gutterR = new THREE.Mesh(gutterGeo, gutterMat);
            gutterR.rotation.x = -Math.PI / 2;
            gutterR.position.set(1.4, -0.05, 0);
            threeScene.add(gutterR);

            // Load bowling pin STL
            loadPinModel();

            isThreeReady = true;
            console.log('Three.js initialized successfully');

        } catch (err) {
            console.error('Three.js init error:', err);
        }
    }

    function loadPinModel() {
        if (!THREE || !THREE.STLLoader) {
            console.warn('STLLoader not available');
            return;
        }

        const loader = new THREE.STLLoader();
        const pinUrl = window.PIN_STL_URL;
        
        if (!pinUrl) {
            console.warn('Pin STL URL not provided');
            return;
        }

        loader.load(
            pinUrl,
            function(geometry) {
                // Center and scale the geometry
                geometry.computeBoundingBox();
                const bbox = geometry.boundingBox;
                const center = new THREE.Vector3();
                bbox.getCenter(center);
                geometry.translate(-center.x, -bbox.min.y, -center.z);
                
                // Scale to appropriate size (about 0.38 units tall)
                const height = bbox.max.y - bbox.min.y;
                const scale = 0.38 / height;
                geometry.scale(scale, scale, scale);
                
                pinGeometry = geometry;
                pinMaterial = new THREE.MeshStandardMaterial({
                    color: 0xf5f5f0,
                    roughness: 0.5,
                    metalness: 0.05
                });
                
                console.log('Bowling pin STL loaded successfully');
            },
            function(xhr) {
                console.log((xhr.loaded / xhr.total * 100) + '% loaded');
            },
            function(error) {
                console.error('Error loading pin STL:', error);
            }
        );
    }

    function startBowlingAnimation(animPinState) {
        if (!isThreeReady || !THREE) {
            console.warn('Three.js not ready');
            return;
        }

        // Clear previous objects
        if (threeBall) {
            threeScene.remove(threeBall);
            threeBall = null;
        }
        threePinObjects.forEach(pin => threeScene.remove(pin.group));
        threePinObjects = [];

        const standingSet = new Set(animPinState ? animPinState.standingBefore : [0,1,2,3,4,5,6,7,8,9]);
        const knockedSet  = new Set(animPinState ? animPinState.knockedThisRoll : []);

        // Convert recorded 2D ball path to 3D world coords.
        // Anchors: ball launch Y (LANE_BOT-BALL_R-8) → Z=5, head-pin Y (HEAD_PIN_Y) → Z=-4
        const ballStartY   = LANE_BOT - BALL_R - 8;
        const gutterCanvasL = PLAY_LEFT  + BALL_R;  // canvas X when hugging left gutter wall
        const gutterCanvasR = PLAY_RIGHT - BALL_R;  // canvas X when hugging right gutter wall
        const gutterSide3D  = animPinState ? animPinState.gutterSide : null;
        let ballPath3D = null;
        if (animPinState && animPinState.ballPath && animPinState.ballPath.length > 1) {
            const raw = animPinState.ballPath.map(p => {
                let x = (p.x - PINS_CX) / (PLAY_W / 2) * 1.25;
                // Remap gutter-wall positions to the actual 3D gutter channel (±1.4)
                if (gutterSide3D === 'left'  && p.x <= gutterCanvasL + 2) x = -1.4;
                if (gutterSide3D === 'right' && p.x >= gutterCanvasR - 2) x =  1.4;
                return { x, z: 5 - (ballStartY - p.y) / (ballStartY - HEAD_PIN_Y) * 9 };
            });
            // Trim points that overshoot the back of the lane (-6) so ball stays on deck
            const trimmed = raw.filter(p => p.z >= -6.0);
            ballPath3D = trimmed.length > 1 ? trimmed : raw.slice(0, 2);
        }

        // Create bowling ball - classic shiny blue/black marbled look
        const ballGeo = new THREE.SphereGeometry(0.22, 32, 32);
        const ballMat = new THREE.MeshStandardMaterial({
            color: 0x1144aa,
            roughness: 0.15,
            metalness: 0.7,
            emissive: 0x001133,
            emissiveIntensity: 0.3
        });
        threeBall = new THREE.Mesh(ballGeo, ballMat);
        const startPt = ballPath3D ? ballPath3D[0] : { x: 0, z: 5 };
        threeBall.position.set(startPt.x, 0.22, startPt.z);
        threeBall.castShadow = true;
        threeBall.receiveShadow = true;
        threeScene.add(threeBall);

        // Create only pins that were standing before this roll
        PIN_POSITIONS.forEach(([px, pz], i) => {
            if (!standingSet.has(i)) return; // Pin was already down — skip it

            const pinGroup = new THREE.Group();

            if (pinGeometry && pinMaterial) {
                // Use loaded STL model
                const pinMesh = new THREE.Mesh(pinGeometry, pinMaterial.clone());
                pinMesh.castShadow = true;
                pinMesh.receiveShadow = true;
                pinGroup.add(pinMesh);
                // Red neck stripe — pin is 0.38 units tall, neck sits ~63% up
                const stripeGeo = new THREE.CylinderGeometry(0.063, 0.063, 0.022, 16);
                const stripeMat = new THREE.MeshStandardMaterial({ color: 0xcc1111, roughness: 0.5 });
                const stripe = new THREE.Mesh(stripeGeo, stripeMat);
                stripe.position.y = 0.245;
                stripe.castShadow = true;
                pinGroup.add(stripe);
            } else {
                // Fallback to procedural geometry
                const bodyGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.38, 16);
                const bodyMat = new THREE.MeshStandardMaterial({
                    color: 0xf5f5f0,
                    roughness: 0.5,
                    metalness: 0.05
                });
                const pinBody = new THREE.Mesh(bodyGeo, bodyMat);
                pinBody.position.y = 0.19;
                pinBody.castShadow = true;
                pinBody.receiveShadow = true;
                pinGroup.add(pinBody);

                // Red stripe at neck
                const stripeGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.04, 16);
                const stripeMat = new THREE.MeshStandardMaterial({
                    color: 0xdd1111,
                    roughness: 0.6
                });
                const stripe = new THREE.Mesh(stripeGeo, stripeMat);
                stripe.position.y = 0.25;
                pinGroup.add(stripe);
            }

            pinGroup.position.set(px, 0, pz);
            threeScene.add(pinGroup);

            threePinObjects.push({
                group: pinGroup,
                velocity: new THREE.Vector3(0, 0, 0),
                angularVel: new THREE.Vector3(0, 0, 0),
                fallen: false,
                shouldFall: knockedSet.has(i),
                chainQueued: false
            });
        });

        // Show container
        threeContainer.style.display = 'block';
        threeContainer.style.opacity = '0';

        bowlingAnim = {
            startTime: performance.now(),
            duration: 3500,
            ballPath3D,
            chainQueue: []   // {pin, triggerAt} for chain-reaction pins
        };
    }

    function triggerPinKnockdown(pin) {
        const dx = pin.group.position.x - threeBall.position.x;
        const dz = pin.group.position.z - threeBall.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz) || 0.1;
        pin.velocity.set(
            (dx / dist) * 0.06 + (Math.random() - 0.5) * 0.02,
            0.15 + Math.random() * 0.05,
            (dz / dist) * 0.06 + (Math.random() - 0.5) * 0.02
        );
        pin.angularVel.set(
            (Math.random() - 0.5) * 0.15,
            (Math.random() - 0.5) * 0.1,
            (Math.random() - 0.5) * 0.15
        );
        pin.fallen = true;
    }

    function drawBowlingAnimation() {
        if (!bowlingAnim || !isThreeReady) return;

        const elapsed = performance.now() - bowlingAnim.startTime;
        const progress = elapsed / bowlingAnim.duration;

        if (progress >= 1) {
            threeContainer.style.display = 'none';
            bowlingAnim = null;
            return;
        }

        // Fade in/out
        const fade = elapsed < 250 ? elapsed / 250
                   : elapsed > bowlingAnim.duration - 300 ? (bowlingAnim.duration - elapsed) / 300
                   : 1;
        threeContainer.style.opacity = fade.toString();

        // Ball animation - follows the real throw path
        const ballProgress = Math.min(elapsed / 1200, 1);
        const pathData = bowlingAnim.ballPath3D;
        if (pathData && pathData.length > 1) {
            const rawIdx = ballProgress * (pathData.length - 1);
            const i0 = Math.floor(rawIdx);
            const i1 = Math.min(i0 + 1, pathData.length - 1);
            const t  = rawIdx - i0;
            threeBall.position.x = pathData[i0].x + (pathData[i1].x - pathData[i0].x) * t;
            threeBall.position.z = pathData[i0].z + (pathData[i1].z - pathData[i0].z) * t;
            // Z-axis lean follows lateral curve
            if (i0 > 0) {
                const lateralDelta = pathData[i0].x - pathData[i0 - 1].x;
                threeBall.rotation.z -= lateralDelta * 0.5;
            }
        } else {
            const ease = 1 - Math.pow(1 - ballProgress, 2);
            threeBall.position.z = 5 - ease * 9.5;
        }
        threeBall.rotation.x += 0.18; // Forward roll

        // Proximity knockdown: pins fall as the ball rolls over them
        threePinObjects.forEach(pin => {
            if (!pin.shouldFall || pin.fallen || pin.chainQueued) return;
            const dx = pin.group.position.x - threeBall.position.x;
            const dz = pin.group.position.z - threeBall.position.z;
            if (Math.sqrt(dx * dx + dz * dz) < 0.42) triggerPinKnockdown(pin);
        });

        // After the ball finishes its path, queue any remaining shouldFall pins
        // (chain-reaction pins the ball didn't pass directly over) with staggered delays
        if (ballProgress >= 1.0) {
            threePinObjects.forEach(pin => {
                if (!pin.shouldFall || pin.fallen || pin.chainQueued) return;
                pin.chainQueued = true;
                const dx = pin.group.position.x - threeBall.position.x;
                const dz = pin.group.position.z - threeBall.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                bowlingAnim.chainQueue.push({ pin, triggerAt: elapsed + 15 + dist * 35 });
            });
        }

        // Fire any queued chain-reaction pins whose delay has elapsed
        bowlingAnim.chainQueue = bowlingAnim.chainQueue.filter(item => {
            if (elapsed >= item.triggerAt) { triggerPinKnockdown(item.pin); return false; }
            return true;
        });

        // Physics for all fallen pins
        threePinObjects.forEach(pin => {
            if (!pin.fallen) return;
            pin.velocity.y -= 0.015;
            pin.group.position.add(pin.velocity);
            pin.group.rotation.x += pin.angularVel.x;
            pin.group.rotation.y += pin.angularVel.y;
            pin.group.rotation.z += pin.angularVel.z;
            pin.velocity.x *= 0.98;
            pin.velocity.z *= 0.98;
            pin.angularVel.multiplyScalar(0.97);
            if (pin.group.position.y < 0.05) {
                pin.group.position.y = 0.05;
                pin.velocity.y *= -0.3;
            }
        });

        // Render
        threeRenderer.render(threeScene, threeCamera);

        // Draw overlay text
        const cx = (PLAY_LEFT + PLAY_RIGHT) / 2;
        if (progress > 0.15 && progress < 0.85) {
            const textFade = Math.sin((progress - 0.15) / 0.7 * Math.PI);
            ctx.save();
            ctx.globalAlpha = fade * textFade * 0.9;
            ctx.textAlign = 'center';
            ctx.font = 'bold 24px Arial';
            ctx.shadowColor = '#ffcc00';
            ctx.shadowBlur = 16;
            ctx.fillStyle = '#ffe44d';
            ctx.fillText('★ FRAME COMPLETE ★', cx, LANE_TOP + 32);
            ctx.shadowBlur = 0;
            ctx.restore();
        }
    }

    // Initialize Three.js when available
    if (typeof window !== 'undefined') {
        setTimeout(() => {
            if (window.THREE) {
                initThreeJS();
            } else {
                console.warn('Three.js not loaded yet');
            }
        }, 200);
    }

    // ─── Boot ─────────────────────────────────────────────────────────────────────
    makePins();
    requestAnimationFrame(loop);

})();
