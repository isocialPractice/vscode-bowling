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
    const BALL_MASS  = 6.8;
    const PIN_MASS   = 1.45;
    const PIN_COLLIDER_R = 10.5;
    const PIN_LINEAR_DRAG = 0.965;
    const PIN_TILT_DRAG = 0.84;
    const PIN_TILT_SPRING = 0.05;
    const PIN_DOWN_TILT = 0.38;
    const PIN_LAYDOWN_TILT = 1.34;
    const PIN_TOPPLE_SPEED = 2.55;
    const PIN_SETTLE_SPEED = 0.09;

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
    const REPLAY_STORAGE_KEY = 'vscode-bowling-replay-enabled';
    let replayEnabled = loadReplayEnabled();

    function loadReplayEnabled() {
        try {
            const stored = window.localStorage.getItem(REPLAY_STORAGE_KEY);
            return stored == null ? true : stored !== 'false';
        } catch {
            return true;
        }
    }

    function saveReplayEnabled(enabled) {
        try {
            window.localStorage.setItem(REPLAY_STORAGE_KEY, String(enabled));
        } catch {
            // Ignore storage failures in restrictive webview contexts.
        }
    }

    function getReplayToggleBox() {
        const px = LANE_RIGHT + 10;
        const pw = W - LANE_RIGHT - 14;
        return {
            x: px,
            y: LANE_TOP + 250,
            w: pw,
            h: 48
        };
    }

    function updateReplayToggleLayout() {
        const panel = document.getElementById('replay-toggle-panel');
        if (!panel) return;

        const rect = canvas.getBoundingClientRect();
        const scaleX = rect.width / W;
        const scaleY = rect.height / H;
        const scale = Math.max(0.82, Math.min(scaleX, scaleY));
        const box = getReplayToggleBox();

        panel.style.left = `${box.x * scaleX}px`;
        panel.style.top = `${box.y * scaleY}px`;
        panel.style.width = `${box.w * scaleX}px`;
        panel.style.height = `${box.h * scaleY}px`;
        panel.style.setProperty('--replay-scale', scale.toFixed(3));
    }

    function initReplayToggle() {
        const shell = document.getElementById('game-shell');
        if (!shell || document.getElementById('replay-toggle-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'replay-toggle-panel';
        panel.innerHTML = [
            '<div class="replay-toggle-copy">',
            '  <div class="replay-toggle-eyebrow">Replay</div>',
            '  <div class="replay-toggle-title">Turn Animation</div>',
            '</div>',
            '<label class="replay-switch" for="replay-toggle-input">',
            '  <input id="replay-toggle-input" type="checkbox" aria-label="Toggle post-turn replay animation">',
            '  <span class="replay-switch-track" aria-hidden="true"></span>',
            '  <span class="replay-switch-thumb" aria-hidden="true"></span>',
            '</label>'
        ].join('');
        shell.appendChild(panel);

        const input = panel.querySelector('#replay-toggle-input');
        if (!input) return;
        input.checked = replayEnabled;
        input.addEventListener('change', () => {
            replayEnabled = input.checked;
            saveReplayEnabled(replayEnabled);
            if (!replayEnabled) {
                bowlingAnim = null;
            }
        });

        updateReplayToggleLayout();
        window.addEventListener('resize', updateReplayToggleLayout);
    }

    // ─── Pins ────────────────────────────────────────────────────────────────────
    function makePins() {
        pins = PIN_DEF.map(([row, col], i) => {
            const rackX = PINS_CX + col * (PIN_GAP_X / 2);
            const rackY = HEAD_PIN_Y - row * PIN_GAP_Y;

            return {
                id: i,
                x: rackX,
                y: rackY,
                rackX,
                rackY,
                vx: 0,
                vy: 0,
                standing: true,
                falling: false,
                fallAngle: 0,
                fallDir: 1,
                swept: false
            };
        });
    }

    function standingCount() { return pins.filter(p => p.standing && !p.swept).length; }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function lerp(start, end, amount) {
        return start + (end - start) * amount;
    }

    function easeOutCubic(amount) {
        return 1 - Math.pow(1 - amount, 3);
    }

    function easeInOutCubic(amount) {
        return amount < 0.5
            ? 4 * amount * amount * amount
            : 1 - Math.pow(-2 * amount + 2, 3) / 2;
    }

    function knockPin(pin) {
        if (!pin.standing || pin.swept) return;

        const sourceBall = ball || { x: pin.x, y: pin.y, vx: 0, vy: 0, spin: 0 };
        pin.standing = false;
        pin.falling = true;
        pin.fallAngle = 0;

        const dx = pin.x - sourceBall.x;
        const dy = pin.y - sourceBall.y;
        const len = Math.hypot(dx, dy) || 1;

        pin.vx = (dx / len) * 3.2 + sourceBall.vx * 0.5 + sourceBall.spin * 0.6;
        pin.vy = (dy / len) * 2.2 + sourceBall.vy * 0.28;
        pin.fallDir = pin.vx >= 0 ? 1 : -1;

        setTimeout(() => chainReact(pin), 90);
    }

    function chainReact(moved) {
        for (const [a, b] of PIN_PAIRS) {
            const other = moved.id === a ? pins[b] : moved.id === b ? pins[a] : null;
            if (!other || !other.standing || other.swept) continue;

            if (Math.hypot(moved.x - other.x, moved.y - other.y) < PIN_R * 3.0) {
                other.standing = false;
                other.falling = true;
                other.fallAngle = 0;
                other.fallDir = moved.vx >= 0 ? 1 : -1;
                other.vx = moved.vx * 0.55;
                other.vy = moved.vy * 0.55;
                setTimeout(() => chainReact(other), 80);
            }
        }
    }

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
            rotation: 0,
            stallFrames: 0,
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

        const launchY = LANE_BOT - BALL_R - 8;
        const laneTravel = clamp((launchY - ball.y) / (launchY - LANE_TOP), 0, 1);
        const hookWindow = clamp((laneTravel - 0.22) / 0.52, 0, 1);
        const rollWindow = clamp((laneTravel - 0.78) / 0.18, 0, 1);
        const hookStrength = (0.004 + hookWindow * 0.028) * (1 - rollWindow * 0.68);

        if (!ball.inGutter) {
            ball.vx += ball.spin * hookStrength;
            ball.spin *= 0.994 - hookWindow * 0.0015;
        } else {
            ball.spin *= 0.96;
            ball.vx *= 0.99;
        }

        ball.vx *= 0.998 - hookWindow * 0.0012;
        ball.vy *= 0.9991;
        ball.rotation += Math.hypot(ball.vx, ball.vy) / BALL_R;

        ball.x += ball.vx;
        ball.y += ball.vy;

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
            // Pin collisions are resolved against the logical 2D pins.
            if (!ball.inGutter) {
                for (const pin of pins) {
                    if (!pin.standing || pin.swept) continue;

                    const dx = ball.x - pin.x;
                    const dy = ball.y - pin.y;
                    if (Math.hypot(dx, dy) < BALL_R + PIN_R + 1) {
                        knockPin(pin);
                        ball.vx *= 0.87;
                        ball.vy *= 0.93;
                    }
                }
            }

        // A real ball can die in the deck after impact instead of cleanly leaving the lane.
        // End the roll once it has reached the pins and stays nearly motionless for a short span.
        const speed = Math.hypot(ball.vx, ball.vy);
        const inPinDeck = ball.y <= HEAD_PIN_Y + PIN_GAP_Y * 3 + BALL_R;
        const hasStalledInDeck = inPinDeck && speed < 0.55 && Math.abs(ball.vy) < 0.28;
        ball.stallFrames = hasStalledInDeck ? ball.stallFrames + 1 : 0;

        // Ball leaves the lane
        if (ball.y + BALL_R < LANE_TOP || (ball.inGutter && ball.y < HEAD_PIN_Y - 30) || ball.stallFrames > 18) {
            endRoll();
        }
    }

    function updatePins() {
        for (const pin of pins) {
            if (!pin.falling || pin.swept) continue;

            pin.x += pin.vx * 0.55;
            pin.y += pin.vy * 0.55;
            pin.vx *= 0.92;
            pin.vy *= 0.92;
            pin.fallAngle += pin.fallDir * 5;

            if (Math.abs(pin.fallAngle) >= 90) {
                pin.fallAngle = 90 * pin.fallDir;
                pin.falling = false;
            }
        }
    }

    // ─── Roll Outcome ────────────────────────────────────────────────────────────
    function shouldReplayAfterRoll(rolls, thisRoll) {
        if (currentFrame < 9) {
            return (currentBall === 0 && thisRoll === 10) || currentBall === 1;
        }

        if (currentBall === 2) return true;
        if (currentBall !== 1) return false;

        const firstRoll = rolls[0] || 0;
        const earnedBonusBall = firstRoll === 10 || firstRoll + thisRoll === 10;
        return !earnedBonusBall;
    }

    function endRoll() {
        if (state !== S.ROLLING) return;

        const totalKnocked = 10 - standingCount();
        const thisRoll = currentBall === 0 ? totalKnocked : totalKnocked - firstBallKnocked;

        if (thisRoll === 10 && currentBall === 0) {
            flash('STRIKE!', '#ffaa00');
        } else if (currentBall > 0 && totalKnocked === 10) {
            flash('SPARE!', '#44ff88');
        } else if (thisRoll > 0) {
            flash(thisRoll + (thisRoll === 1 ? ' pin' : ' pins'), '#ffffff');
        } else {
            flash('Gutter!', '#ff5555');
        }

        const frame = frames[currentFrame];
        frame.rolls.push(thisRoll);
        computeScores();

        const shouldAnimate = replayEnabled && shouldReplayAfterRoll(frame.rolls, thisRoll);

        state = S.SETTLING;
        if (shouldAnimate) {
            startBowlingAnimation(
                pins
                    .filter(pin => !pin.swept)
                    .map(pin => ({
                        id: pin.id,
                        rackX: pin.rackX,
                        rackY: pin.rackY,
                        standing: pin.standing,
                        fallDir: pin.fallDir,
                        vx: pin.vx,
                        vy: pin.vy
                    })),
                ballPath.slice()
            );
        }
        ball = null;

        const settleDur = shouldAnimate && bowlingAnim ? bowlingAnim.duration : 1400;
        setTimeout(() => advance(totalKnocked), settleDur);
    }

    function advance(totalKnocked) {
        const rolls = frames[currentFrame].rolls;

        if (currentFrame < 9) {
            if (currentBall === 0 && rolls[0] === 10) {
                nextFrame();
            } else if (currentBall === 0) {
                firstBallKnocked = totalKnocked;
                for (const pin of pins) {
                    if (!pin.standing) pin.swept = true;
                }
                currentBall = 1;
                state = S.READY;
            } else {
                nextFrame();
            }
        } else if (rolls.length === 1) {
            if (rolls[0] === 10) {
                makePins();
                firstBallKnocked = 0;
            } else {
                firstBallKnocked = totalKnocked;
                for (const pin of pins) {
                    if (!pin.standing) pin.swept = true;
                }
            }
            currentBall = 1;
            state = S.READY;
        } else if (rolls.length === 2) {
            const isStrike = rolls[0] === 10;
            const isSpare = !isStrike && (rolls[0] + rolls[1] === 10);

            if (isStrike || isSpare) {
                if (isStrike && rolls[1] === 10) {
                    makePins();
                    firstBallKnocked = 0;
                } else if (isStrike) {
                    firstBallKnocked = rolls[1];
                    for (const pin of pins) {
                        if (!pin.standing) pin.swept = true;
                    }
                } else {
                    makePins();
                    firstBallKnocked = 0;
                }
                currentBall = 2;
                state = S.READY;
            } else {
                state = S.GAME_OVER;
            }
        } else {
            state = S.GAME_OVER;
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
        if (!pin.standing) ctx.rotate((pin.fallAngle * Math.PI) / 180);

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

        const replayBox = getReplayToggleBox();
        ctx.fillStyle = 'rgba(8,12,22,0.88)';
        ctx.beginPath();
        ctx.roundRect(replayBox.x, replayBox.y, replayBox.w, replayBox.h, 8);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.stroke();

        updateReplayToggleLayout();
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
        if (!isThreeReady) {
            for (const pin of pins) drawPin(pin);
            drawBall();
        }
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

    // ─── Live Three.js Gameplay Overlay ──────────────────────────────────────────
    let THREE = null;
    let threeScene = null;
    let threeCamera = null;
    let threeReplayCamera = null;
    let threeRenderer = null;
    let threeBall = null;
    let threePinObjects = [];
    let threeReplayLaneGroup = null;
    let threeContainer = null;
    let isThreeReady = false;
    let pinGeometry = null;
    let ballGeometry = null;
    let pinMaterial = null;
    let ballMaterial = null;
    let bowlingAnim = null;

    const THREE_PIN_HEIGHT = 40;
    const THREE_BALL_DIAMETER = BALL_R * 2;
    const GAMEPLAY_CAMERA_POS = { x: 0, y: 980, z: 110 };
    const GAMEPLAY_CAMERA_LOOK = { x: 0, y: 0, z: 40 };
    const REPLAY_CAMERA_FROM = { x: 0, y: 840, z: 150 };
    const REPLAY_CAMERA_TO = { x: -250, y: 220, z: 430 };
    const REPLAY_CAMERA_LOOK_FROM = { x: 0, y: 0, z: 30 };
    const REPLAY_CAMERA_LOOK_TO = { x: 0, y: 48, z: -120 };
    const REPLAY_PIN_RADIUS = PIN_R * 1.15;
    const REPLAY_DECK_LEFT = PLAY_LEFT + PIN_R * 0.7;
    const REPLAY_DECK_RIGHT = PLAY_RIGHT - PIN_R * 0.7;
    const REPLAY_DECK_TOP = HEAD_PIN_Y - PIN_GAP_Y * 4.25;
    const REPLAY_DECK_BOTTOM = HEAD_PIN_Y + PIN_GAP_Y * 2.35;

    function canvasToWorldX(x) {
        return x - W / 2;
    }

    function canvasToWorldZ(y) {
        return y - H / 2;
    }

    function createFallbackPinGeometry() {
        const geometry = new THREE.CylinderGeometry(8, 13, THREE_PIN_HEIGHT, 20);
        geometry.translate(0, THREE_PIN_HEIGHT / 2, 0);
        return geometry;
    }

    function createPinVisual() {
        const group = new THREE.Group();
        const body = new THREE.Mesh(pinGeometry || createFallbackPinGeometry(), pinMaterial.clone());
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        const stripe = new THREE.Mesh(
            new THREE.CylinderGeometry(6.2, 6.2, 2.3, 20),
            new THREE.MeshStandardMaterial({ color: 0xca2b22, roughness: 0.35, metalness: 0.05 })
        );
        stripe.position.y = 26;
        stripe.castShadow = true;
        group.add(stripe);
        return group;
    }

    function createBallVisual() {
        const mesh = new THREE.Mesh(
            ballGeometry || new THREE.SphereGeometry(BALL_R, 28, 28),
            ballMaterial.clone()
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }

    function createReplayLaneGroup() {
        const group = new THREE.Group();
        const laneCenterX = canvasToWorldX((LANE_LEFT + LANE_RIGHT) * 0.5);
        const laneCenterZ = canvasToWorldZ((LANE_TOP + LANE_BOT) * 0.5);
        const laneLength = (LANE_BOT - LANE_TOP) + 70;

        const laneSurface = new THREE.Mesh(
            new THREE.BoxGeometry(LANE_W, 2.8, laneLength),
            new THREE.MeshStandardMaterial({ color: 0xc3924e, roughness: 0.72, metalness: 0.04 })
        );
        laneSurface.position.set(laneCenterX, -1.45, laneCenterZ);
        laneSurface.receiveShadow = true;
        group.add(laneSurface);

        const pinDeck = new THREE.Mesh(
            new THREE.BoxGeometry(PLAY_W + 22, 1.6, 110),
            new THREE.MeshStandardMaterial({ color: 0xe6c88f, roughness: 0.48, metalness: 0.02 })
        );
        pinDeck.position.set(canvasToWorldX(PINS_CX), -0.58, canvasToWorldZ(HEAD_PIN_Y - PIN_GAP_Y * 1.5));
        pinDeck.receiveShadow = true;
        group.add(pinDeck);

        const gutterGeometry = new THREE.BoxGeometry(GUTTER_W, 6, laneLength + 10);
        const gutterMaterial = new THREE.MeshStandardMaterial({ color: 0x1f2630, roughness: 0.94, metalness: 0.02 });
        const leftGutter = new THREE.Mesh(gutterGeometry, gutterMaterial);
        leftGutter.position.set(canvasToWorldX(LANE_LEFT + GUTTER_W * 0.5), -0.2, laneCenterZ);
        leftGutter.receiveShadow = true;
        group.add(leftGutter);

        const rightGutter = leftGutter.clone();
        rightGutter.position.x = canvasToWorldX(LANE_RIGHT - GUTTER_W * 0.5);
        group.add(rightGutter);

        const foulLine = new THREE.Mesh(
            new THREE.BoxGeometry(PLAY_W, 1.2, 3),
            new THREE.MeshStandardMaterial({ color: 0xb63a2c, roughness: 0.55, metalness: 0.04 })
        );
        foulLine.position.set(canvasToWorldX(PINS_CX), -0.18, canvasToWorldZ(LANE_BOT - 60));
        group.add(foulLine);

        group.visible = false;
        return group;
    }

    function ensureThreeObjects() {
        if (!threeScene || !THREE) return;

        if (!threeBall) {
            threeBall = createBallVisual();
            threeBall.visible = false;
            threeScene.add(threeBall);
        }

        if (threePinObjects.length !== PIN_DEF.length) {
            threePinObjects.forEach(entry => {
                if (entry) threeScene.remove(entry.group);
            });
            threePinObjects = [];

            for (let index = 0; index < PIN_DEF.length; index++) {
                const group = createPinVisual();
                threeScene.add(group);
                threePinObjects.push({ group });
            }
        }
    }

    function rebuildThreePins() {
        if (!threeScene) return;
        threePinObjects.forEach(entry => {
            if (entry) threeScene.remove(entry.group);
        });
        threePinObjects = [];
        ensureThreeObjects();
    }

    function rebuildThreeBall() {
        if (!threeScene) return;
        const wasVisible = threeBall ? threeBall.visible : false;
        if (threeBall) threeScene.remove(threeBall);
        threeBall = createBallVisual();
        threeBall.visible = wasVisible;
        threeScene.add(threeBall);
    }

    function loadPinModel() {
        if (!THREE || !THREE.STLLoader || !window.PIN_STL_URL) return;

        const loader = new THREE.STLLoader();
        loader.load(
            window.PIN_STL_URL,
            (geometry) => {
                geometry.computeVertexNormals();
                geometry.computeBoundingBox();
                const bbox = geometry.boundingBox;
                const centerX = (bbox.min.x + bbox.max.x) * 0.5;
                const centerZ = (bbox.min.z + bbox.max.z) * 0.5;
                geometry.translate(-centerX, -bbox.min.y, -centerZ);
                geometry.computeBoundingBox();
                const size = new THREE.Vector3();
                geometry.boundingBox.getSize(size);
                const scale = THREE_PIN_HEIGHT / Math.max(size.y, 1);
                geometry.scale(scale, scale, scale);
                geometry.computeVertexNormals();
                pinGeometry = geometry;
                rebuildThreePins();
            },
            undefined,
            (error) => {
                console.warn('Unable to load bowling pin STL:', error);
            }
        );
    }

    function loadBallModel() {
        if (!THREE || !THREE.STLLoader || !window.BALL_STL_URL) return;

        const loader = new THREE.STLLoader();
        loader.load(
            window.BALL_STL_URL,
            (geometry) => {
                geometry.computeVertexNormals();
                geometry.computeBoundingBox();
                const bbox = geometry.boundingBox;
                const center = new THREE.Vector3();
                bbox.getCenter(center);
                geometry.translate(-center.x, -center.y, -center.z);
                geometry.computeBoundingBox();
                const size = new THREE.Vector3();
                geometry.boundingBox.getSize(size);
                const diameter = Math.max(size.x, size.y, size.z);
                const scale = THREE_BALL_DIAMETER / Math.max(diameter, 1);
                geometry.scale(scale, scale, scale);
                geometry.computeVertexNormals();
                ballGeometry = geometry;
                rebuildThreeBall();
            },
            undefined,
            (error) => {
                console.warn('Unable to load bowling ball STL:', error);
            }
        );
    }

    function initThreeJS() {
        try {
            THREE = window.THREE;
            if (!THREE) return;

            threeContainer = document.getElementById('threejs-container');
            if (!threeContainer) return;

            threeScene = new THREE.Scene();
            threeCamera = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 1, 2500);
            threeCamera.position.set(GAMEPLAY_CAMERA_POS.x, GAMEPLAY_CAMERA_POS.y, GAMEPLAY_CAMERA_POS.z);
            threeCamera.lookAt(GAMEPLAY_CAMERA_LOOK.x, GAMEPLAY_CAMERA_LOOK.y, GAMEPLAY_CAMERA_LOOK.z);

            threeReplayCamera = new THREE.PerspectiveCamera(36, W / H, 1, 2500);
            threeReplayCamera.position.set(REPLAY_CAMERA_FROM.x, REPLAY_CAMERA_FROM.y, REPLAY_CAMERA_FROM.z);
            threeReplayCamera.lookAt(REPLAY_CAMERA_LOOK_FROM.x, REPLAY_CAMERA_LOOK_FROM.y, REPLAY_CAMERA_LOOK_FROM.z);

            threeRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
            threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            threeRenderer.setSize(W, H, false);
            threeRenderer.shadowMap.enabled = true;
            threeRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
            threeRenderer.setClearColor(0x000000, 0);
            threeContainer.innerHTML = '';
            threeContainer.appendChild(threeRenderer.domElement);

            const ambient = new THREE.HemisphereLight(0xf6fbff, 0x74839a, 0.78);
            threeScene.add(ambient);

            const keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
            keyLight.position.set(-180, 520, -120);
            keyLight.castShadow = true;
            keyLight.shadow.mapSize.width = 2048;
            keyLight.shadow.mapSize.height = 2048;
            keyLight.shadow.camera.left = -260;
            keyLight.shadow.camera.right = 260;
            keyLight.shadow.camera.top = 260;
            keyLight.shadow.camera.bottom = -260;
            keyLight.shadow.camera.near = 20;
            keyLight.shadow.camera.far = 1200;
            threeScene.add(keyLight);

            const fillLight = new THREE.PointLight(0x7ca7ff, 0.35, 1200);
            fillLight.position.set(0, 400, 260);
            threeScene.add(fillLight);

            const shadowPlane = new THREE.Mesh(
                new THREE.PlaneGeometry(PLAY_W + 56, (LANE_BOT - LANE_TOP) + 40),
                new THREE.ShadowMaterial({ opacity: 0.22 })
            );
            shadowPlane.rotation.x = -Math.PI / 2;
            shadowPlane.position.set(
                canvasToWorldX(PINS_CX),
                0.01,
                canvasToWorldZ((LANE_TOP + LANE_BOT) * 0.5)
            );
            shadowPlane.receiveShadow = true;
            threeScene.add(shadowPlane);

            threeReplayLaneGroup = createReplayLaneGroup();
            threeScene.add(threeReplayLaneGroup);

            pinMaterial = new THREE.MeshPhysicalMaterial({
                color: 0xf6f1ea,
                roughness: 0.22,
                metalness: 0.03,
                clearcoat: 0.9,
                clearcoatRoughness: 0.17
            });
            ballMaterial = new THREE.MeshPhysicalMaterial({
                color: 0x193f96,
                roughness: 0.14,
                metalness: 0.12,
                clearcoat: 1,
                clearcoatRoughness: 0.06,
                emissive: 0x071633,
                emissiveIntensity: 0.25
            });

            isThreeReady = true;
            ensureThreeObjects();
            loadPinModel();
            loadBallModel();
        } catch (err) {
            console.error('Three.js init error:', err);
        }
    }

    function sampleReplayPath(path, progress) {
        if (!path.length) return { x: 0, z: 0 };
        if (path.length === 1) return path[0];

        const scaled = clamp(progress, 0, 1) * (path.length - 1);
        const index = Math.floor(scaled);
        const nextIndex = Math.min(index + 1, path.length - 1);
        const localT = scaled - index;

        return {
            x: path[index].x + (path[nextIndex].x - path[index].x) * localT,
            z: path[index].z + (path[nextIndex].z - path[index].z) * localT
        };
    }

    function applyThreePinTransform(group, pin) {
        const fallAngle = clamp((pin.fallAngle || 0) * Math.PI / 180, -Math.PI / 2, Math.PI / 2);
        const yaw = pin.yaw || 0;
        const wobble = clamp(pin.wobble || 0, -0.12, 0.12);
        group.position.set(canvasToWorldX(pin.x), pin.height || 0, canvasToWorldZ(pin.y));
        group.rotation.x = pin.standing ? 0 : clamp((pin.vy || 0) * 0.03, -0.28, 0.28);
        group.rotation.y = yaw + (pin.standing ? 0 : clamp((pin.vx || 0) * 0.03, -0.28, 0.28));
        group.rotation.z = pin.standing ? wobble : fallAngle;
    }

    function resolveReplayPinCollisions(replayPins) {
        const minDist = REPLAY_PIN_RADIUS * 2;

        for (let index = 0; index < replayPins.length; index++) {
            const first = replayPins[index];
            const firstActive = !first.standing || Math.abs(first.wobbleVel || 0) > 0.002;
            if (!firstActive) continue;

            for (let otherIndex = index + 1; otherIndex < replayPins.length; otherIndex++) {
                const second = replayPins[otherIndex];
                const secondActive = !second.standing || Math.abs(second.wobbleVel || 0) > 0.002;
                if (!secondActive) continue;

                const dx = second.x - first.x;
                const dy = second.y - first.y;
                const distSq = dx * dx + dy * dy;
                if (distSq >= minDist * minDist) continue;

                const dist = Math.sqrt(distSq) || 0.001;
                const nx = dx / dist;
                const ny = dy / dist;
                const overlap = minDist - dist;
                const firstMove = first.standing ? 0.18 : 0.52;
                const secondMove = second.standing ? 0.18 : 0.52;
                first.x -= nx * overlap * firstMove;
                first.y -= ny * overlap * firstMove;
                second.x += nx * overlap * secondMove;
                second.y += ny * overlap * secondMove;

                const relVx = first.vx - second.vx;
                const relVy = first.vy - second.vy;
                const approach = relVx * nx + relVy * ny;
                if (approach <= 0) continue;

                const impulse = approach * 0.42;
                if (!first.standing) {
                    first.vx -= nx * impulse;
                    first.vy -= ny * impulse;
                    first.angularVel = (first.angularVel || 0) + impulse * 0.035 * Math.sign(nx || 1);
                } else {
                    first.wobbleVel = (first.wobbleVel || 0) - impulse * 0.012 * Math.sign(nx || 1);
                }

                if (!second.standing) {
                    second.vx += nx * impulse;
                    second.vy += ny * impulse;
                    second.angularVel = (second.angularVel || 0) + impulse * 0.035 * Math.sign(nx || 1);
                } else {
                    second.wobbleVel = (second.wobbleVel || 0) + impulse * 0.012 * Math.sign(nx || 1);
                }
            }
        }
    }

    function updateReplayCamera(revealProgress, driftProgress) {
        if (!threeReplayCamera) return;

        const revealT = easeInOutCubic(revealProgress);
        const driftT = easeOutCubic(driftProgress);
        const swing = Math.sin(driftT * Math.PI) * 28;
        const rise = Math.sin(driftT * Math.PI) * 14;

        threeReplayCamera.position.set(
            lerp(REPLAY_CAMERA_FROM.x, REPLAY_CAMERA_TO.x, revealT) + swing,
            lerp(REPLAY_CAMERA_FROM.y, REPLAY_CAMERA_TO.y, revealT) - rise,
            lerp(REPLAY_CAMERA_FROM.z, REPLAY_CAMERA_TO.z, revealT) - swing * 0.85
        );
        threeReplayCamera.lookAt(
            lerp(REPLAY_CAMERA_LOOK_FROM.x, REPLAY_CAMERA_LOOK_TO.x, revealT),
            lerp(REPLAY_CAMERA_LOOK_FROM.y, REPLAY_CAMERA_LOOK_TO.y, revealT) + rise * 0.1,
            lerp(REPLAY_CAMERA_LOOK_FROM.z, REPLAY_CAMERA_LOOK_TO.z, revealT) - swing * 0.15
        );
    }

    function launchReplayPin(pin, energyBoost) {
        if (pin.launched) return;

        const boost = 0.9 + energyBoost * 0.18;
        pin.launched = true;
        pin.standing = false;
        pin.vx = clamp(
            pin.sourceVx * 0.62 + pin.fallDir * (0.9 + boost * 0.34) + pin.sideBias * 0.78,
            -4.4,
            4.4
        );
        pin.vy = clamp(
            pin.sourceVy * 0.48 - 1.05 - pin.depthBias * 1.5 - boost * 0.16,
            -4.5,
            1.3
        );
        pin.height = 0.03;
        pin.heightVel = 0.46 + boost * 0.1;
        pin.angularVel = clamp(pin.vx * 0.09 + pin.sideBias * 0.05, -0.34, 0.34);
        pin.wobble = 0;
        pin.wobbleVel = 0;
    }

    function confineReplayPinToDeck(pin) {
        if (pin.x < REPLAY_DECK_LEFT) {
            pin.x = REPLAY_DECK_LEFT;
            pin.vx = Math.abs(pin.vx) * 0.38;
            pin.angularVel += 0.03;
        } else if (pin.x > REPLAY_DECK_RIGHT) {
            pin.x = REPLAY_DECK_RIGHT;
            pin.vx = -Math.abs(pin.vx) * 0.38;
            pin.angularVel -= 0.03;
        }

        if (pin.y < REPLAY_DECK_TOP) {
            pin.y = REPLAY_DECK_TOP;
            pin.vy = Math.abs(pin.vy) * 0.24;
        } else if (pin.y > REPLAY_DECK_BOTTOM) {
            pin.y = REPLAY_DECK_BOTTOM;
            pin.vy = -Math.abs(pin.vy) * 0.26;
        }
    }

    function startBowlingAnimation(replayPins, replayPath) {
        if (!isThreeReady || !replayPins.length) {
            bowlingAnim = null;
            return;
        }

        const pathSource = replayPath && replayPath.length
            ? replayPath
            : [
                { x: PINS_CX, y: LANE_BOT - BALL_R - 16 },
                { x: PINS_CX, y: HEAD_PIN_Y + PIN_GAP_Y }
            ];

        const now = performance.now();
        bowlingAnim = {
            startTime: now,
            lastFrameTime: now,
            duration: 4300,
            revealDuration: 540,
            ballDuration: 1450,
            ballPath3D: pathSource.map(point => ({
                x: canvasToWorldX(point.x),
                z: canvasToWorldZ(point.y)
            })),
            pins: replayPins.map(pin => ({
                id: pin.id,
                x: pin.rackX,
                y: pin.rackY,
                vx: 0,
                vy: 0,
                standing: true,
                fallAngle: 0,
                fallDir: pin.fallDir || 1,
                shouldFall: !pin.standing,
                sourceVx: pin.vx || 0,
                sourceVy: pin.vy || 0,
                depthBias: clamp((HEAD_PIN_Y - pin.rackY) / (PIN_GAP_Y * 3), 0, 1),
                sideBias: clamp((pin.rackX - PINS_CX) / (PIN_GAP_X * 3), -1, 1),
                launchDelay: 55 + clamp((HEAD_PIN_Y - pin.rackY) / (PIN_GAP_Y * 3), 0, 1) * 240 + Math.abs(pin.rackX - PINS_CX) * 0.72,
                launched: false,
                yaw: 0,
                angularVel: 0,
                wobble: 0,
                wobbleVel: 0,
                height: 0,
                heightVel: 0
            }))
        };
    }

    function syncThreeReplayView() {
        if (!bowlingAnim || !isThreeReady || !threeRenderer || !threeScene || !threeReplayCamera) return;

        ensureThreeObjects();

        const now = performance.now();
        const elapsed = now - bowlingAnim.startTime;
        const frameDt = clamp((now - bowlingAnim.lastFrameTime) / 16.6667, 0.7, 1.8);
        bowlingAnim.lastFrameTime = now;

        const revealProgress = clamp(elapsed / bowlingAnim.revealDuration, 0, 1);
        const motionElapsed = Math.max(elapsed - bowlingAnim.revealDuration, 0);
        const ballProgress = clamp(motionElapsed / bowlingAnim.ballDuration, 0, 1);
        const driftProgress = clamp(motionElapsed / Math.max(bowlingAnim.duration - bowlingAnim.revealDuration, 1), 0, 1);
        updateReplayCamera(revealProgress, driftProgress);

        if (threeReplayLaneGroup) {
            threeReplayLaneGroup.visible = true;
        }

        if (threeBall) {
            if (revealProgress >= 1 && motionElapsed < bowlingAnim.ballDuration + 360) {
                const ballPoint = sampleReplayPath(bowlingAnim.ballPath3D, ballProgress);
                threeBall.visible = true;
                threeBall.position.set(ballPoint.x, BALL_R, ballPoint.z);
                threeBall.rotation.set(ballProgress * Math.PI * 7, Math.sin(ballProgress * Math.PI) * 0.12, 0);
            } else {
                threeBall.visible = false;
            }
        }

        const impactElapsed = motionElapsed - bowlingAnim.ballDuration * 0.82;
        for (const pin of bowlingAnim.pins) {
            if (!pin.shouldFall || pin.launched || impactElapsed < pin.launchDelay) continue;

            launchReplayPin(pin, 1 + pin.depthBias * 0.4);
        }

        threePinObjects.forEach(entry => {
            if (entry) entry.group.visible = false;
        });

        for (const pin of bowlingAnim.pins) {
            const entry = threePinObjects[pin.id];
            if (!entry) continue;

            if (pin.standing) {
                pin.wobbleVel += -pin.wobble * 0.18 * frameDt;
                pin.wobble += pin.wobbleVel * 0.72 * frameDt;
                pin.wobbleVel *= Math.pow(0.82, frameDt);
                pin.wobble *= Math.pow(0.91, frameDt);
            } else {
                pin.x += pin.vx * 0.37 * frameDt;
                pin.y += pin.vy * 0.37 * frameDt;
                pin.height = Math.max(0, pin.height + pin.heightVel * 0.16 * frameDt);
                pin.heightVel -= 0.18 * frameDt;
                if (pin.height === 0 && pin.heightVel < 0) {
                    pin.heightVel *= -0.24;
                    if (Math.abs(pin.heightVel) < 0.03) pin.heightVel = 0;
                }
                pin.vx *= Math.pow(pin.height > 0 ? 0.96 : 0.93, frameDt);
                pin.vy *= Math.pow(pin.height > 0 ? 0.95 : 0.92, frameDt);
                pin.angularVel *= Math.pow(0.92, frameDt);
                pin.yaw += pin.angularVel * frameDt;
                pin.fallAngle = clamp(
                    pin.fallAngle + (2.1 + Math.hypot(pin.vx, pin.vy) * 1.3 + Math.max(pin.heightVel, 0) * 0.4) * pin.fallDir * frameDt,
                    -90,
                    90
                );
                confineReplayPinToDeck(pin);
            }

            if (pin.standing && pin.shouldFall && !pin.launched && motionElapsed > pin.launchDelay * 0.58 && Math.abs(pin.wobbleVel) > 0.028) {
                launchReplayPin(pin, Math.abs(pin.wobbleVel) * 15);
            }

            if (pin.yaw) {
                pin.yaw *= Math.pow(0.985, frameDt);
            }

            entry.group.visible = true;
            applyThreePinTransform(entry.group, pin);
        }

        resolveReplayPinCollisions(bowlingAnim.pins);

        threeRenderer.render(threeScene, threeReplayCamera);

        if (elapsed >= bowlingAnim.duration) {
            bowlingAnim = null;
        }
    }

    function syncThreeGameplayView() {
        if (!isThreeReady || !threeRenderer || !threeScene || !threeCamera) return;

        ensureThreeObjects();

        if (threeReplayLaneGroup) {
            threeReplayLaneGroup.visible = false;
        }

        const showBall = !!ball || state === S.READY || state === S.CHARGING;
        if (threeBall) {
            threeBall.visible = showBall;
            if (showBall) {
                const ballX = ball ? ball.x : aimX;
                const ballY = ball ? ball.y : (LANE_BOT - BALL_R - 16);
                const ballAngle = ball ? ball.rotation : rollAngle * Math.PI / 180;
                threeBall.position.set(canvasToWorldX(ballX), BALL_R, canvasToWorldZ(ballY));
                threeBall.rotation.set(0, 0, 0);
                threeBall.rotateZ(-ballAngle);
                if (ball) {
                    threeBall.rotateX(ball.spin * 2.2);
                }
            }
        }

        pins.forEach((pin, index) => {
            const entry = threePinObjects[index];
            if (!entry) return;

            entry.group.visible = !pin.swept;
            if (!entry.group.visible) return;
            applyThreePinTransform(entry.group, pin);
        });

        threeRenderer.render(threeScene, threeCamera);
    }

    function drawBowlingAnimation() {
        if (!replayEnabled) {
            bowlingAnim = null;
            syncThreeGameplayView();
            return;
        }

        if (bowlingAnim) {
            syncThreeReplayView();
            return;
        }

        syncThreeGameplayView();
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
    initReplayToggle();
    makePins();
    requestAnimationFrame(loop);

})();
