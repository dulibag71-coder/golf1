import { SceneManager } from '../graphics/SceneManager.js';

// ammo.js는 비동기 로딩이 필요함
export class PhysicsEngine {
    constructor(app) {
        this.app = app;
        this.world = null;
        this.terrains = []; // { mesh, type, bounds }
        this.Ammo = null; // 초기화 후 할당됨
        this.spin = null; // setupPhysicsWorld에서 초기화
        this.MAGNUS_COEFF = 0.0001; // 마그누스 효과 계수

        this.wind = { x: 0, y: 0, z: 0 }; // 초기 바람 세기

        // 1. Area Types
        this.AreaType = {
            IN_PLAY: 'IN_PLAY',
            OB: 'OB',
            PENALTY_WATER: 'PENALTY_WATER',
            PENALTY_LATERAL: 'PENALTY_LATERAL',
            GREEN: 'GREEN',
            FAIRWAY: 'FAIRWAY',
            ROUGH: 'ROUGH',
            BUNKER: 'BUNKER'
        };

        // 2. Course Data (Simple Polygon Course)
        this.courseAreas = [
            // --- Boundaries ---
            {
                id: 'ob_left_1', type: this.AreaType.OB,
                polygon: [[-200, -600], [-160, -600], [-160, 100], [-200, 100]]
            },
            {
                id: 'ob_right_1', type: this.AreaType.OB,
                polygon: [[160, -600], [200, -600], [200, 100], [160, 100]]
            },

            // --- Hazards ---
            {
                id: 'water_hz_1', type: this.AreaType.PENALTY_WATER,
                polygon: [[-80, -350], [80, -350], [80, -300], [-80, -300]],
                strokePenalty: 1
            },

            // --- Bunkers (New) ---
            {
                // Green-side Bunker (Left)
                id: 'bunker_green_L', type: this.AreaType.BUNKER,
                polygon: [[-35, -530], [-22, -530], [-22, -510], [-35, -510]],
                friction: 3.5, restitution: 0.0
            },
            {
                // Green-side Bunker (Right)
                id: 'bunker_green_R', type: this.AreaType.BUNKER,
                polygon: [[22, -540], [35, -540], [35, -520], [22, -520]],
                friction: 3.5, restitution: 0.0
            },
            {
                // Fairway Bunker
                id: 'bunker_fairway', type: this.AreaType.BUNKER,
                polygon: [[15, -250], [35, -250], [35, -210], [15, -210]],
                friction: 3.5, restitution: 0.0
            },

            // --- Green ---
            {
                id: 'green_1', type: this.AreaType.GREEN,
                polygon: [[-20, -550], [20, -550], [20, -500], [-20, -500]],
                friction: 0.1, restitution: 0.5
            },

            // --- Fairway (Shaped) ---
            // Dog-leg style or widening path
            {
                id: 'fairway_1', type: this.AreaType.FAIRWAY,
                polygon: [
                    [-30, -500], [30, -500], // Near Green
                    [40, -300], [-40, -300], // Mid-section (Wide)
                    [-20, -40], [20, -40]    // Tee landing zone
                ],
                friction: 0.5, restitution: 0.3
            }
        ];
    }

    async init() {
        console.log('Ammo.js 로딩 시도...');
        try {
            if (typeof Ammo === 'function') {
                const AmmoLib = await Ammo();
                this.Ammo = AmmoLib;
                window.Ammo = AmmoLib; // 전역 호환성 유지
                this.setupPhysicsWorld();
                console.log('Ammo.js 초기화 완료');
            } else if (typeof Ammo !== 'undefined' && Ammo.btVector3) {
                this.Ammo = Ammo;
                this.setupPhysicsWorld();
                console.log('Ammo.js 이미 로드됨');
            } else {
                throw new Error('Ammo.js가 정의되지 않았습니다. index.html의 스크립트 로드를 확인하세요.');
            }
        } catch (e) {
            console.error('Ammo Initialization Error:', e);
            throw e; // main.js에서 catch하도록 던짐
        }
    }

    setupPhysicsWorld() {
        if (!this.Ammo) return;
        const Ammo = this.Ammo;

        const collisionConfiguration = new Ammo.btDefaultCollisionConfiguration();
        const dispatcher = new Ammo.btCollisionDispatcher(collisionConfiguration);
        const overlappingPairCache = new Ammo.btDbvtBroadphase();
        const solver = new Ammo.btSequentialImpulseConstraintSolver();

        this.world = new Ammo.btDiscreteDynamicsWorld(
            dispatcher, overlappingPairCache, solver, collisionConfiguration
        );
        this.world.setGravity(new Ammo.btVector3(0, -9.81, 0));

        this.spin = new Ammo.btVector3(0, 0, 0);

        this.createGround();
    }

    createGround() {
        const Ammo = this.Ammo;
        // 무한 평면 지면
        const groundShape = new Ammo.btStaticPlaneShape(new Ammo.btVector3(0, 1, 0), 0);
        const groundTransform = new Ammo.btTransform();
        groundTransform.setIdentity();

        const mass = 0;
        const localInertia = new Ammo.btVector3(0, 0, 0);
        const motionState = new Ammo.btDefaultMotionState(groundTransform);
        const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, groundShape, localInertia);
        const body = new Ammo.btRigidBody(rbInfo);
        body.setRestitution(0.5);
        body.setFriction(0.8);

        this.world.addRigidBody(body);
        this.createBall(); // 물리 공 생성 추가
    }

    createBall() {
        const Ammo = this.Ammo;
        const radius = 0.042;
        const mass = 0.045; // 45g

        const shape = new Ammo.btSphereShape(radius);
        const transform = new Ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new Ammo.btVector3(0, 0.042, 0)); // 시작 위치

        const localInertia = new Ammo.btVector3(0, 0, 0);
        shape.calculateLocalInertia(mass, localInertia);

        const motionState = new Ammo.btDefaultMotionState(transform);
        const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia);
        this.ball = new Ammo.btRigidBody(rbInfo);

        this.ball.setRestitution(0.65);
        this.ball.setFriction(0.3);
        this.ball.setRollingFriction(0.1);

        this.world.addRigidBody(this.ball);
    }

    addTerrain(bounds, type) {
        // 물리 월드에 구역 추가 또는 판정용 데이터 저장
        this.terrains.push({ bounds, type });
    }

    // 3. Point in Polygon Algorithm (Ray-Casting)
    isPointInPolygon(point, vs) {
        let x = point[0], y = point[1];
        let inside = false;
        for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
            let xi = vs[i][0], yi = vs[i][1];
            let xj = vs[j][0], yj = vs[j][1];
            let intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    checkBallStatus() {
        if (!this.ball || !this.Ammo) return { type: this.AreaType.FAIRWAY };
        const Ammo = this.Ammo;
        const ms = this.ball.getMotionState();
        if (!ms) return { type: this.AreaType.FAIRWAY };

        const transform = new Ammo.btTransform();
        ms.getWorldTransform(transform);
        const origin = transform.getOrigin();
        const px = origin.x();
        const pz = origin.z();

        // 1. TerrainManager (Mask Based) Check
        if (this.app.terrainManager && this.app.terrainManager.isLoaded) {
            const terrainData = this.app.terrainManager.getPhysicsParams(px, pz); // { type, friction, restitution }
            return terrainData;
        }

        // 2. Fallback: Course Areas (Priority: OB > Hazard > Green)
        for (const area of this.courseAreas) {
            if (this.isPointInPolygon([px, pz], area.polygon)) {
                return area;
            }
        }

        // 3. Fallback: Simple Bounds
        if (Math.abs(px) < 30) {
            return { type: this.AreaType.FAIRWAY, friction: 0.5, restitution: 0.3 };
        }
        return { type: this.AreaType.ROUGH, friction: 1.2, restitution: 0.1 };
    }

    update(dt) {
        if (this.world && this.ball) {
            this.applyAerodynamics(dt);
            this.world.stepSimulation(dt, 10);

            // 실시간 상태 체크 및 물리 속성 반영
            const statusData = this.checkBallStatus();
            const type = statusData.type;

            // Apply Physics Properties
            const friction = statusData.friction !== undefined ? statusData.friction : 0.5;
            const restitution = statusData.restitution !== undefined ? statusData.restitution : 0.3;

            this.ball.setFriction(friction);
            this.ball.setRestitution(restitution);

            // 특수 지형 로직 (속도 감속 등)
            if (type === this.AreaType.BUNKER) {
                // 벙커: 매우 급격한 감속
                const vel = this.ball.getLinearVelocity();
                vel.multiplyScalar(0.92);
                this.ball.setLinearVelocity(vel);
            } else if (type === this.AreaType.PENALTY_WATER) {
                // 물: 멈춤
                const vel = this.ball.getLinearVelocity();
                vel.multiplyScalar(0.5);
                this.ball.setLinearVelocity(vel);
            } else if (type === this.AreaType.GREEN) {
                this.updatePuttingPhysics(dt);
            }
        }
    }

    updatePuttingPhysics(dt) {
        // 그린 경사 및 미세 감속 시뮬레이션
        // 단순 구현: 약간의 불규칙성(Roughness 0.45 시각적 대응)
        const vel = this.ball.getLinearVelocity();
        // 속도가 아주 느릴 때 멈춤 처리 강화
        if (vel.length() < 0.1) {
            vel.setX(0); vel.setY(0); vel.setZ(0);
            this.ball.setLinearVelocity(vel);
        }
    }

    applyAerodynamics(dt) {
        if (!this.ball || !this.Ammo) return;
        const Ammo = this.Ammo;

        // 1. 마그누스 효과 (Spin에 의한 양력/커브)
        const vel = this.ball.getLinearVelocity();
        const vz = vel.z();

        // 외적 연산 (임시 간소화 구현: 사이드 스핀 -> X축 굴곡)
        const sideSwing = this.spin.y() * vz * this.MAGNUS_COEFF;
        const liftForce = this.spin.x() * vz * this.MAGNUS_COEFF; // 백스핀 -> 양력

        this.ball.applyCentralForce(new Ammo.btVector3(sideSwing, liftForce, 0));

        // 2. 공기 저항 (Drag)
        const dragX = vel.x() * -0.01 + this.wind.x * 0.05;
        const dragY = vel.y() * -0.01 + this.wind.y * 0.05;
        const dragZ = vel.z() * -0.01 + this.wind.z * 0.05;
        this.ball.applyCentralForce(new Ammo.btVector3(dragX, dragY, dragZ));
    }

    setWind(value) {
        // 간소화를 위해 Z축(정면/맞바람) 위주로 적용
        this.wind.z = value;
        console.log(`Physics Wind Set: ${value} m/s`);
    }

    setBallProperties(props) {
        if (!this.ball) return;
        if (props.restitution !== undefined) this.ball.setRestitution(props.restitution);
        if (props.friction !== undefined) this.ball.setFriction(props.friction);
    }

    setInitialShot(velocity, spin) {
        if (!this.ball || !this.Ammo) return;
        const Ammo = this.Ammo;
        this.ball.setLinearVelocity(new Ammo.btVector3(velocity.x, velocity.y, velocity.z));
        this.ball.setAngularVelocity(new Ammo.btVector3(spin.x, spin.y, spin.z)); // 스핀 반영
        this.spin = new Ammo.btVector3(spin.x, spin.y, spin.z);
        this.ball.activate();
    }

    resetBall(pos = { x: 0, y: 0.042, z: 0 }) {
        if (!this.ball || !this.Ammo) return;
        const Ammo = this.Ammo;
        const transform = new Ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new Ammo.btVector3(pos.x, pos.y, pos.z));

        let ms = this.ball.getMotionState();
        if (ms) ms.setWorldTransform(transform);
        this.ball.setWorldTransform(transform);

        this.ball.setLinearVelocity(new Ammo.btVector3(0, 0, 0));
        this.ball.setAngularVelocity(new Ammo.btVector3(0, 0, 0));
        this.ball.clearForces();
        this.ball.activate();
    }
}
