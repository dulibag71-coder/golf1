import { SceneManager } from './graphics/SceneManager.js';
import { UIManager } from './ui/UIManager.js';
import { EnvironmentPanel } from './ui/EnvironmentPanel.js';
import { ClubSelector } from './ui/ClubSelector.js';
import { Minimap } from './ui/Minimap.js';
import { PhysicsEngine } from './physics/PhysicsEngine.js';
import { MotionEngine } from './vision/MotionEngine.js';
import { AudioService } from './services/AudioService.js';
import { SyncService } from './services/SyncService.js';
import { TerrainManager } from './game/TerrainManager.js';

class AirSwingApp {
    constructor() {
        this.ui = new UIManager(this);
        this.env = new EnvironmentPanel(this.ui);
        this.clubs = new ClubSelector(this.ui);
        this.minimap = new Minimap('minimap');
        this.scene = new SceneManager(this, 'game-canvas');
        this.terrainManager = new TerrainManager(this.scene); // 지형 매니저 생성
        this.physics = new PhysicsEngine(this); // physics가 app.terrainManager 접근 가능하도록 수정됨
        this.vision = new MotionEngine(
            this,
            document.getElementById('input-video'),
            document.getElementById('pose-canvas')
        );
        this.audio = new AudioService();
        this.sync = new SyncService();

        // 앱 연동 이벤트 구독
        this.sync.subscribe('inventory_updated', (data) => this.onInventoryUpdate(data));
        this.sync.subscribe('game_command', (data) => this.onGameCommand(data));
        this.sync.subscribe('camera_change', (data) => this.onCameraChange(data));
        this.sync.subscribe('env_update', (data) => this.onEnvUpdate(data));
        this.sync.subscribe('caddy_update', (data) => this.onCaddyUpdate(data));
        this.sync.subscribe('god_mode', (data) => this.onGodMode(data));
        this.sync.subscribe('login_success', (data) => {
            this.ui.hideLogin(); // 로그인창 닫기
            this.setGameState('ready'); // 게임 시작
            this.ui.showNotification(`${data.userId}님 로그인 완료!`);
        });

        this.state = 'loading'; // loading, address, swing, flight, result, putting
        this.inventory = {
            currentBall: 'standard', // standard, pro, premium
            balls: {
                standard: { name: 'Standard (2pc)', speedMult: 1.0, spinMult: 1.0, color: 0xffffff },
                pro: { name: 'Pro V1 Style (3pc)', speedMult: 1.05, spinMult: 1.2, color: 0xeeeeee },
                premium: { name: 'Golden Ball (4pc)', speedMult: 1.15, spinMult: 1.5, color: 0xffd700 }
            }
        };
        this.lastTime = performance.now();
        this.init();
    }

    async init() {
        console.log('GolfUniverse 초기화 시작...');
        if (typeof window === 'undefined') return;

        this.ui.updateProgress(10, '라이브러리 로딩 중...');

        try {
            // 0. 서버에서 게임 설정(아이템 등) 가져오기
            this.ui.updateProgress(20, '서버 설정 동기화 중...');
            try {
                // 3초 타임아웃 추가
                const fetchWithTimeout = (url, ms) => {
                    return Promise.race([
                        fetch(url),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
                    ]);
                };

                const response = await fetchWithTimeout('/api/game/config', 3000); // 3초 제한
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const config = await response.json();
                console.log('Server Config Loaded:', config);
                this.applyServerConfig(config);
            } catch (err) {
                console.warn('서버 설정 로드 실패 (타임아웃/오류), 기본값 사용', err);
            }

            // 1. 지형 데이터 로드 (Physics보다 먼저)
            this.ui.updateProgress(25, '골프장 지형 및 마스크 로딩 중...');
            await this.terrainManager.init();

            // 2. Ammo.js 비동기 로딩 및 물리 엔진 초기화
            this.ui.updateProgress(30, '물리 엔진 시스템(Ammo.js) 준비 중...');
            await this.physics.init(); // 내부에서 await Ammo() 수행

            // 2. 렌더링 엔진 설정
            this.ui.updateProgress(50, '그래픽 엔진(Three.js) 월드 생성 중...');
            // SceneManager는 이미 생성자에서 renderer를 준비함

            // 3. 비전 엔진 초기화 (MediaPipe Pose)
            this.ui.updateProgress(70, 'AI 스윙 감지 모듈 초기화 중...');

            this.vision.setCallbacks(
                () => { // onReady
                    if (this.state === 'loading' || this.state === 'ready' || this.state === 'result') {
                        this.setGameState('address');
                    }
                },
                (shotData) => { // onShot
                    this.onShot(shotData);
                }
            );

            await this.vision.init();

            this.ui.updateProgress(100, '모든 시스템 준비 완료!');
            this.onInitComplete();

        } catch (e) {
            console.error('System Initialization Failed:', e);
            this.ui.updateProgress(100, '일부 모듈 로드 실패 (Failsafe 실행)');
            // 에러가 발생하더라도 최소한의 렌더링은 가능하도록 처리
            this.onInitComplete();
        }
    }

    applyServerConfig(config) {
        if (config.equippedBall) {
            this.scene.setBallType(config.equippedBall);
            // 물리 속성도 서버에서 온 데이터로 조정
            if (config.equippedBall.physicsMod) {
                this.physics.setBallProperties(config.equippedBall.physicsMod);
            }
            console.log(`아이템 장착됨: ${config.equippedBall.name}`);
        }

        if (config.env) {
            this.scene.setEnvironment(config.env);
            console.log(`환경 설정 적용됨: ${config.env.weather}`);
        }
    }

    onShot(data) {
        if (this.state !== 'ready' && this.state !== 'address') return;

        console.log('샷 감지!', data);
        this.shotStartTime = performance.now();
        this.setGameState('flight');

        // 1. Aim Rotation 적용
        const aimAngle = this.scene.aimAngle || 0;
        const v = data.velocity;

        // Rotate Vector (Rotate X/Z plane around Y axis)
        // Sensor Coordinate: X (Right), Y (Up), Z (Forward/Depth)
        // Aim Rotation: +Angle = CCW (Left)

        const cos = Math.cos(aimAngle);
        const sin = Math.sin(aimAngle);

        // New Velocity (Z is forward negative? No, usually forward)
        // Assuming Physics Engine uses standard Z-forward or Z-negative checks.
        // PhysicsEngine uses (x, y, z).

        const rVx = v.x * cos - v.z * sin;
        const rVz = v.x * sin + v.z * cos;

        const finalVel = { x: rVx, y: v.y, z: rVz };

        this.physics.setInitialShot(finalVel, data.spin);
        this.audio.playEffect('hit');
        this.lastShotVelocity = finalVel;
    }

    handleShotComplete(distance) {
        const statusData = this.physics.checkBallStatus();
        const type = statusData.type;
        const AreaType = this.physics.AreaType;

        this.score += 1; // Count the stroke just made

        console.log(`Shot Result: Terrain=${type}, Distance=${distance.toFixed(1)}m`);

        // 1. OB Rules
        if (type === AreaType.OB) {
            this.ui.showNotification('⚠️ OB! 1벌타 부여 및 원위치');
            this.score += 1; // Penalty Stroke
            this.audio.announceShot('ob');

            // Reset to Tee or Previous (Simply Tee for now as "Reset")
            this.scene.initBall();
            this.physics.resetBall({ x: 0, y: 0.042, z: 0 });
            this.setGameState('ready');
            return;
        }

        // 2. Penalty Area (Water/Lateral) Rules
        if (type === AreaType.PENALTY_WATER || type === AreaType.PENALTY_LATERAL) {
            this.ui.showNotification('💦 해저드! 1벌타 (드롭존 이동)');
            this.score += 1; // Penalty Stroke
            this.audio.announceShot('hazard');

            // Move to Mock Drop Zone (Near Water Hazard)
            this.scene.updateBall({ x: 0, y: 0.1, z: -290 }, { x: 0, y: 0, z: 0, w: 1 });
            this.physics.resetBall({ x: 0, y: 0.1, z: -290 });
            this.setGameState('ready');
            return;
        }

        // 3. Green Rules (Putting)
        if (type === AreaType.GREEN) {
            this.ui.showNotification('⛳ 그린 온! 퍼팅 모드 전환');
            this.setGameState('putting');
            this.scene.enterPuttingMode();
            return;
        }

        // 4. Normal Play (Fairway/Rough)
        this.handleNormalPlayEnd(distance, type);
    }

    handleNormalPlayEnd(distance, type) {
        this.setGameState('ready');
        this.vision.resetState();

        // 모바일 앱으로 결과 전송
        const shotData = {
            distance: distance,
            ballSpeed: Math.sqrt(this.lastShotVelocity.x ** 2 + this.lastShotVelocity.y ** 2 + this.lastShotVelocity.z ** 2),
            launchAngle: Math.atan2(this.lastShotVelocity.y, this.lastShotVelocity.z) * (180 / Math.PI),
            rewardCoins: Math.floor(distance * 10),
            score: this.score, // Send current score
            timestamp: Date.now()
        };

        this.sync.updateGameState({
            lastShot: shotData,
            totalRounds: 1
        });

        this.ui.showNotification(`샷 완료! 비거리: ${distance.toFixed(1)}m (현재 스코어: ${this.score})`);
    }

    checkHoleIn() {
        if (this.state !== 'putting' || !this.physics.ball) return;

        const ballPos = this.physics.ball.getMotionState().getWorldTransform(new Ammo.btTransform()).getOrigin();
        // Hole at (0, 0, -525)
        const dx = ballPos.x();
        const dz = ballPos.z() + 525; // Relative to hole Z
        const dist = Math.sqrt(dx * dx + dz * dz);

        // Cup Radius ~0.108m / 2 = 0.054m. 
        // Logic: low speed + close distance = In
        const vel = this.physics.ball.getLinearVelocity();
        const speed = vel.length();

        if (dist < 0.1 && speed < 1.0) {
            // "Suck In" (Magnet effect)
            const forceX = -dx * 10;
            const forceZ = -dz * 10;
            this.physics.ball.applyCentralForce(new Ammo.btVector3(forceX, 0, forceZ));

            if (dist < 0.03) {
                this.handleHoleIn();
            }
        }
    }

    handleHoleIn() {
        this.ui.showNotification(`🎉 홀인! (총 ${this.score}타)`);
        this.audio.playEffect('powerup'); // Clapping?
        this.setGameState('result');
    }

    onInitComplete() {
        if (this.state !== 'loading') return;
        this.ui.hideLoader();
        this.state = 'waiting_login';
        this.initLoginSession(); // QR 세션 시작
        this.startLoop();
    }

    async initLoginSession() {
        try {
            const res = await fetch('/api/auth/session/create');
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`HTTP ${res.status}: ${text.substring(0, 50)}`);
            }
            const data = await res.json();
            const sessionId = data.sessionId;

            // Render QR
            const container = document.getElementById('qr-code-container');
            const text = document.getElementById('session-code-text');
            if (container && text) {
                container.innerHTML = '';
                new QRCode(container, {
                    text: sessionId,
                    width: 128,
                    height: 128
                });
                text.innerText = sessionId;
            }

            this.pollSessionStatus(sessionId);
        } catch (e) {
            console.error('Session Create Failed:', e);
            const errEl = document.getElementById('session-code-text');
            if (errEl) {
                errEl.innerText = 'FAIL';
                errEl.style.fontSize = '14px';
                errEl.innerHTML += `<br><span style="font-size:10px; color:red">${e.message}</span>`;
            }
        }
    }

    async pollSessionStatus(sessionId) {
        if (this.state !== 'waiting_login') return;

        try {
            const res = await fetch(`/api/auth/session/check?sessionId=${sessionId}`);
            const data = await res.json();

            if (data.status === 'connected') {
                this.userId = data.userId;
                this.sync.userId = data.userId; // Sync 모듈에도 ID 전달
                this.ui.showNotification('모바일 앱과 연결되었습니다! 🔗');
                // 장착 아이템 등 로드
                this.sync.loadGameConfig();

                // 로그인 오버레이 숨김 및 게임 시작
                document.getElementById('login-overlay').style.display = 'none';
                this.setGameState('address');
            } else {
                setTimeout(() => this.pollSessionStatus(sessionId), 2000); // 2초 주기 폴링
            }
        } catch (e) {
            console.error('Session Poll Error:', e);
            setTimeout(() => this.pollSessionStatus(sessionId), 5000);
        }
    }

    setGameState(newState) {
        this.state = newState;
        this.ui.setMode(newState);

        if (newState === 'ready') {
            this.audio.announceShot('ready');
        } else if (newState === 'flight') {
            this.scene.setCameraMode('follow');
            this.audio.announceShot('impact');
        } else if (newState === 'result') {
            const status = this.physics.checkBallStatus();
            const totalDist = this.physics.ball ? this.physics.ball.position.z * -1 : 0;

            // 코인 보상 계산
            let reward = 100; // 기본 참가 보상
            if (totalDist > 250) reward += 200; // 장타 보상
            if (status === 'FAIRWAY') reward += 100;

            // 앱으로 보상 및 샷 데이터 전송
            this.sync.updateShotData({
                distance: totalDist,
                ballSpeed: 65 + Math.random() * 10,
                launchAngle: 12 + Math.random() * 4,
                rewardCoins: reward,
                timestamp: Date.now()
            });

            this.ui.showNotification(`${reward} G-Coin 획득! 🪙`);

            if (status === 'FAIRWAY') this.audio.announceShot('good');
            else if (status === 'BUNKER') this.audio.announceShot('bunker');
            else if (status === 'WATER') this.audio.announceShot('hazard');
            else if (status === 'OB') this.audio.announceShot('ob');
        }

        console.log(`[GameState] -> ${newState}`);
    }

    togglePuttingMode(isPutting) {
        const gauge = document.getElementById('putter-gauge');
        if (isPutting) {
            gauge.classList.remove('hidden');
            if (this.state !== 'flight') this.setGameState('putting');
        } else {
            gauge.classList.add('hidden');
            if (this.state === 'putting') this.setGameState('address');
        }
    }

    // --- Event Handlers for Sync ---
    onInventoryUpdate(data) {
        this.inventory.currentBall = data.equippedBall;
        const ballData = this.inventory.balls[data.equippedBall];
        if (this.scene && ballData) {
            this.scene.setBallType(ballData);
            this.audio.playEffect('click');
        }
    }

    onGameCommand(data) {
        if (data.command === 'mulligan') {
            this.setGameState('address');
            this.scene.initBall(); // 공 리셋
            this.physics.resetBall(); // 물리 리셋
            this.ui.showNotification('멀리건 사용됨! (다시 치세요)');
        } else if (data.command === 'camera') {
            this.scene.setCameraMode(data.mode);
        } else if (data.command === 'aim') {
            this.scene.rotateAim(data.dir);
        } else if (data.command === 'club') {
            this.clubs.setClub(data.value);
            this.ui.showNotification(`클럽 변경: ${data.value}`);
        }
    }

    onCameraChange(data) {
        this.scene.setCameraMode(data.mode);
    }

    onEnvUpdate(data) {
        if (data.type === 'wind') {
            this.physics.setWind(data.value);
            this.ui.showNotification(`바람 세기 변경: ${data.value}m/s`);
        }
    }

    onCaddyUpdate(data) {
        if (this.audio) {
            this.audio.setVoice(data.voice);
            this.ui.showNotification('캐디 목소리 변경됨');
        }
    }

    onGodMode(data) {
        if (data.enabled) {
            // Physics Hack: Low Gravity
            if (this.physics.world) {
                this.physics.world.setGravity(new Ammo.btVector3(0, -3.0, 0)); // Moon Gravity (ish)
            }
            // Visual Hack: Golden Hour
            if (this.scene.sun) {
                this.scene.sun.color.setHex(0xffaa00);
                this.scene.sun.intensity = 5.0;
            }
            this.audio.playEffect('powerup'); // Assuming you have this or generic sound
            console.log('⚡ GOD MODE ENABLED');
        }
    }

    startLoop() {
        const animate = (time) => {
            const dt = (time - this.lastTime) / 1000;
            this.lastTime = time;

            requestAnimationFrame(animate);

            // 1. 물리 시뮬레이션 (공이 움직이는 상태일 때만)
            if (this.state === 'flight' || this.state === 'putting') {
                this.physics.update(dt);
                this.checkHoleIn(); // Check if ball enters hole

                // 공의 물리 상태를 렌더링 엔진으로 동기화
                if (this.physics.ball) {
                    const transform = new Ammo.btTransform();
                    this.physics.ball.getMotionState().getWorldTransform(transform);
                    const origin = transform.getOrigin();
                    const rotation = transform.getRotation();

                    this.scene.updateBall(
                        { x: origin.x(), y: origin.y(), z: origin.z() },
                        { x: rotation.x(), y: rotation.y(), z: rotation.z(), w: rotation.w() }
                    );

                    // 1.1 샷 종료 체크 (공이 정지했는지)
                    const vel = this.physics.ball.getLinearVelocity();
                    const speed = Math.sqrt(vel.x() ** 2 + vel.y() ** 2 + vel.z() ** 2);

                    if (speed < 0.1 && time > (this.shotStartTime + 1000)) {
                        const finalDistance = Math.abs(origin.z()); // 출발점이 0,0,0 가정
                        this.handleShotComplete(finalDistance);
                    }
                }
            }

            // 2. 그래픽 렌더링 (Three.js)
            this.scene.render();

            // 3. 미니맵 & HUD 업데이트
            this.minimap.draw({
                ballPos: this.scene.ballMesh ? this.scene.ballMesh.position : { x: 0, y: 0 },
                wind: this.env.state
            });
        };
        animate(performance.now());
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.app = new AirSwingApp();
});
