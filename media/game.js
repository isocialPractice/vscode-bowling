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
    let pins  = [];
    let ball  = null;

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
        setTimeout(() => advance(totalKnocked), 1400);
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
        drawStartScreen();

        if (state === S.ROLLING)  updateBall();
        updatePins();

        requestAnimationFrame(loop);
    }

    // ─── Boot ─────────────────────────────────────────────────────────────────────
    makePins();
    requestAnimationFrame(loop);

})();
