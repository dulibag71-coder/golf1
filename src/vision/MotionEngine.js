export class MotionEngine {
    constructor(app, videoElement, canvasElement) {
        this.app = app;
        this.video = videoElement;
        this.canvas = canvasElement;
        this.ctx = this.canvas.getContext('2d');
        this.pose = null;
        this.stableFrames = 0;
        this.lastLandmarks = null;
        this.onReadyCallback = null;
        this.onShotCallback = null;
        this.personDetected = false;
        this.state = 'idle'; // idle, address, swing
    }

    setCallbacks(onReady, onShot) {
        this.onReadyCallback = onReady;
        this.onShotCallback = onShot;
    }

    async init(onReady) {
        this.onReadyCallback = onReady;

        return new Promise((resolve) => {
            const checkModules = () => {
                const CameraModule = window.Camera || (typeof Camera !== 'undefined' ? Camera : null);
                const PoseModule = window.Pose || (typeof Pose !== 'undefined' ? Pose : null);

                if (CameraModule && PoseModule) {
                    if (!this.pose) {
                        this.pose = new PoseModule({
                            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
                        });
                        this.pose.setOptions({
                            modelComplexity: 1,
                            smoothLandmarks: true,
                            minDetectionConfidence: 0.5,
                            minTrackingConfidence: 0.5
                        });
                        this.pose.onResults((results) => this.onResults(results));
                    }

                    try {
                        const camera = new CameraModule(this.video, {
                            onFrame: async () => {
                                if (this.pose) await this.pose.send({ image: this.video });
                            },
                            width: 640,
                            height: 480
                        });
                        camera.start();
                        console.log('MediaPipe Camera Started');
                        resolve();
                    } catch (e) {
                        console.error('Camera Start Error:', e);
                        resolve(); // Proceed anyway but log error
                    }
                } else {
                    console.warn('MediaPipe Libraries loading...');
                    setTimeout(checkModules, 500);
                }
            };
            checkModules();
        });
    }

    onResults(results) {
        this.ctx.save();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // 거울 모드로 그리기 (사용자에게 더 익숙함)
        this.ctx.translate(this.canvas.width, 0);
        this.ctx.scale(-1, 1);
        this.ctx.drawImage(results.image, 0, 0, this.canvas.width, this.canvas.height);

        if (results.poseLandmarks) {
            this.personDetected = true;
            this.drawSkeleton(results.poseLandmarks);
            this.analyzeMotion(results.poseLandmarks);
        } else {
            if (this.personDetected) {
                console.log('Player lost');
                this.personDetected = false;
                this.state = 'idle';
                this.stableFrames = 0;
            }
        }
        this.ctx.restore();
    }

    drawSkeleton(landmarks) {
        // 주요 관절 그리기
        this.ctx.fillStyle = "#00ff00";
        this.ctx.strokeStyle = "#ffffff";
        this.ctx.lineWidth = 2;

        const connect = (i, j) => {
            const p1 = landmarks[i];
            const p2 = landmarks[j];
            this.ctx.beginPath();
            this.ctx.moveTo(p1.x * this.canvas.width, p1.y * this.canvas.height);
            this.ctx.lineTo(p2.x * this.canvas.width, p2.y * this.canvas.height);
            this.ctx.stroke();
        };

        // 몸체 연결
        connect(11, 12); // shoulders
        connect(11, 23); connect(12, 24); // torso
        connect(23, 24); // hips
        connect(11, 13); connect(13, 15); // left arm
        connect(12, 14); connect(14, 16); // right arm

        // 관절 점
        [11, 12, 13, 14, 15, 16, 23, 24].forEach(i => {
            const p = landmarks[i];
            this.ctx.beginPath();
            this.ctx.arc(p.x * this.canvas.width, p.y * this.canvas.height, 4, 0, 2 * Math.PI);
            this.ctx.fill();
        });
    }

    analyzeMotion(landmarks) {
        if (!this.lastLandmarks) {
            this.lastLandmarks = landmarks;
            return;
        }

        // 1. 관절 이동량 계산 (Wrists movement)
        const lw = landmarks[15]; // left wrist
        const rw = landmarks[16]; // right wrist
        const lastLw = this.lastLandmarks[15];
        const lastRw = this.lastLandmarks[16];

        const movement = Math.sqrt(
            Math.pow(lw.x - lastLw.x, 2) + Math.pow(lw.y - lastLw.y, 2)
        ) + Math.sqrt(
            Math.pow(rw.x - lastRw.x, 2) + Math.pow(rw.y - lastRw.y, 2)
        );

        // 2. 상태 머신 로직
        if (this.state === 'idle' || this.state === 'swing') {
            // 어드레스 감지: 일정 시간 동안 움직임이 적고 양 손이 아래에 있음
            if (movement < 0.005 && lw.y > 0.6 && rw.y > 0.6) {
                this.stableFrames++;
                if (this.stableFrames > 30) {
                    this.state = 'address';
                    console.log('Motion: Address (READY)');
                    if (this.onReadyCallback) this.onReadyCallback();
                }
            } else {
                this.stableFrames = 0;
            }
        }
        else if (this.state === 'address') {
            // 스윙 트리거: 어드레스 상태에서 갑작스러운 양 손의 빠른 휘두름 감지
            if (movement > 0.08) {
                console.log('Motion: Swing Impact!');
                this.state = 'swing';
                this.triggerShot(movement);
                this.stableFrames = 0;
            }
            // 어드레스 취소 (너무 많이 움직이면 다시 대기)
            else if (movement > 0.02) {
                this.stableFrames--;
                if (this.stableFrames < 0) {
                    this.state = 'idle';
                    console.log('Motion: Reset to Idle');
                }
            }
        }

        this.lastLandmarks = landmarks;
    }

    triggerShot(speed) {
        if (!this.onShotCallback) return;

        // 속도 기반 물리값 계산 (임시 매핑)
        const ballSpeed = 30 + (speed * 500); // m/s
        const velocity = {
            x: (Math.random() - 0.5) * 5, // 좌우 편차
            y: 15 + Math.random() * 10,  // 발사각
            z: -ballSpeed                // 전진 속도
        };

        const spin = {
            x: 2500 + Math.random() * 1000, // 백스핀
            y: (Math.random() - 0.5) * 500,  // 사이드 스핀
            z: 0
        };

        this.onShotCallback({ velocity, spin });
    }

    resetState() {
        this.state = 'idle';
        this.stableFrames = 0;
    }
}
