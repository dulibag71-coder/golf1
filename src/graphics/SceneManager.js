import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export class SceneManager {
    constructor(app, canvasId) {
        this.app = app;
        this.canvas = document.getElementById(canvasId);
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true,
            powerPreference: "high-performance"
        });

        // UE5 Style Rendering Setup
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.VSMShadowMap; // 고품질 그림자
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping; // 시네마틱 톤매핑
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);

        this.grassMaterials = [];
        this.grassMaterial = null;
        this.ballMesh = null;
        this.initLights();
        this.initEnvironment();
        this.initBall();
        this.initInstancedGrass();
        this.initPostProcessing(); // Hyper-Upgrade
        this.initPhysicalSky(); // Hyper-Upgrade 1: Physical Sky
        this.initBallTrail(); // Hyper-Upgrade 2: Ball Trails

        window.addEventListener('resize', () => this.onResize());
    }

    initPostProcessing() {
        this.composer = new EffectComposer(this.renderer);
        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        // 블룸 효과 조절 (기존 1.2 -> 0.4로 하향하여 눈부심 방지)
        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            0.4, 0.4, 0.85
        );
        bloomPass.threshold = 0.7; // 밝은 영역만 번지도록
        bloomPass.strength = 0.4;
        bloomPass.radius = 0.2;
        this.composer.addPass(bloomPass);
    }

    initPhysicalSky() {
        this.sky = new Sky();
        this.sky.scale.setScalar(450000);
        this.scene.add(this.sky);

        this.sunVec = new THREE.Vector3();
        const effectController = {
            turbidity: 10,
            rayleigh: 3,
            mieCoefficient: 0.005,
            mieDirectionalG: 0.7,
            elevation: 2,
            azimuth: 180,
        };

        const uniforms = this.sky.material.uniforms;
        uniforms['turbidity'].value = effectController.turbidity;
        uniforms['rayleigh'].value = effectController.rayleigh;
        uniforms['mieCoefficient'].value = effectController.mieCoefficient;
        uniforms['mieDirectionalG'].value = effectController.mieDirectionalG;

        const phi = THREE.MathUtils.degToRad(90 - effectController.elevation);
        const theta = THREE.MathUtils.degToRad(effectController.azimuth);
        this.sunVec.setFromSphericalCoords(1, phi, theta);
        uniforms['sunPosition'].value.copy(this.sunVec);
    }

    initBallTrail() {
        this.trailPoints = [];
        this.trailGeometry = new THREE.BufferGeometry();
        this.trailMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2, transparent: true, opacity: 0.6 });
        this.trailLine = new THREE.Line(this.trailGeometry, this.trailMaterial);
        this.trailLine.frustumCulled = false;
        this.scene.add(this.trailLine);
    }

    initBall() {
        const geometry = new THREE.SphereGeometry(0.042, 32, 32);
        const material = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.5,
            metalness: 0.1
        });
        this.ballMesh = new THREE.Mesh(geometry, material);
        this.ballMesh.castShadow = true;
        this.ballMesh.receiveShadow = true;
        this.scene.add(this.ballMesh);

        // 초기 위치 (티박스)
        this.ballMesh.position.set(0, 0.042, 0);
    }

    initLights() {
        // 자연광 (Sky Blue Ambient)
        const ambient = new THREE.HemisphereLight(0x87ceeb, 0x27ae60, 0.4);
        this.scene.add(ambient);

        // 태양광 (기존 2.5 -> 1.2로 하향)
        this.sun = new THREE.DirectionalLight(0xffffff, 1.2);
        this.sun.position.set(200, 300, 100);
        this.sun.castShadow = true;
        this.sun.shadow.camera.left = -200;
        this.sun.shadow.camera.right = 200;
        this.sun.shadow.camera.top = 200;
        this.sun.shadow.camera.bottom = -200;
        this.sun.shadow.mapSize.width = 4096;
        this.sun.shadow.mapSize.height = 4096;
        this.scene.add(this.sun);

        // 부드러운 안개 (Depth Fog)
        this.scene.fog = new THREE.FogExp2(0x87ceeb, 0.002);
    }

    initEnvironment() {
        // 배경: 고품질 스카이 박스 대체용 시각적 보정
        this.scene.background = new THREE.Color(0x87ceeb);

        // 1. 기본 지면: 러프 (Rough)
        this.createTerrainArea(-200, 200, -600, 100, 0x1e5631, 'ROUGH');

        // 2. 페어웨이 (Fairway)
        this.createTerrainArea(-30, 30, -500, -40, 0x27ae60, 'FAIRWAY');

        // 3. 그린 (Green)
        this.createTerrainArea(-20, 20, -550, -500, 0x2ecc71, 'GREEN');

        // 4. 해저드 (Water)
        this.createTerrainArea(-80, 80, -350, -300, 0x3498db, 'WATER');

        // 5. 벙커 (Bunker)
        this.createTerrainArea(20, 35, -200, -160, 0xe3c18d, 'BUNKER');
        this.createTerrainArea(-35, -20, -400, -360, 0xe3c18d, 'BUNKER');

        // 6. OB 구역 (경고 빨간선 효과)
        this.createTerrainArea(-160, -150, -600, 100, 0xff0000, 'OB');
        this.createTerrainArea(150, 160, -600, 100, 0xff0000, 'OB');

        // 6. OB 구역 표시 (빨간 말뚝 대신 붉은 바닥 경계)
        this.createTerrainArea(-155, -150, -500, 50, 0xff0000, 'OB');
        this.createTerrainArea(150, 155, -500, 50, 0xff0000, 'OB');

        // 초기 카메라 위치
        this.camera.position.set(0, 1.8, 8);
        this.camera.lookAt(0, 0.8, -50);
    }

    createTerrainArea(xMin, xMax, zMin, zMax, color, type) {
        const width = xMax - xMin;
        const height = zMax - zMin;
        const geo = new THREE.PlaneGeometry(width, Math.abs(height));
        const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
        const mesh = new THREE.Mesh(geo, mat);

        mesh.position.set((xMin + xMax) / 2, 0.01, (zMin + zMax) / 2);
        mesh.rotation.x = -Math.PI / 2;
        mesh.receiveShadow = true;
        this.scene.add(mesh);

        // 잔디 밀도 차이 연출 (러프 vs 페어웨이)
        if (type !== 'BUNKER' && type !== 'WATER') {
            this.addGrassPatch(xMin, xMax, zMin, zMax, type === 'ROUGH' ? 3000 : 1000);
        }

        // 물리 엔진 연동
        if (this.app && this.app.physics) {
            this.app.physics.addTerrain({ xMin, xMax, zMin, zMax }, type);
        }
    }

    initInstancedGrass() {
        // 티박스 주변 조밀한 잔디 추가
        // 전체 필드에 걸쳐 잔디를 배치하기 위해 더 넓은 영역과 더 많은 개수를 사용
        this.addGrassPatch(-100, 100, -450, 100, 40000); // 잔디 개수 조정 (성능 최적화)
    }

    addGrassPatch(xMin, xMax, zMin, zMax, count) {
        const dummy = new THREE.Object3D();
        const geometry = new THREE.ConeGeometry(0.12, 0.5, 3);
        geometry.translate(0, 0.25, 0);

        // 재질을 한 번만 생성하고 공유
        if (!this.grassMaterial) {
            this.grassMaterial = new THREE.MeshStandardMaterial({
                color: 0x27ae60,
                roughness: 0.7,
                metalness: 0.1,
                side: THREE.DoubleSide
            });

            this.grassMaterial.onBeforeCompile = (shader) => {
                try {
                    shader.uniforms.uTime = { value: 0 };
                    shader.vertexShader = `
                        uniform float uTime;
                        ${shader.vertexShader}
                    `.replace(
                        '#include <begin_vertex>',
                        `
                        #include <begin_vertex>
                        float windStrength = 0.15;
                        float windSpeed = 1.5;
                        float angle = sin(uTime * windSpeed + position.x * 0.5 + position.z * 0.5) * windStrength;
                        float dist = position.y; 
                        transformed.x += sin(angle) * dist;
                        transformed.z += cos(angle) * dist;
                        `
                    );
                    this.grassMaterials.push(shader);
                    this.grassMaterial.userData.shader = shader;
                } catch (e) {
                    console.error('Shader compilation failed, falling back to basic material.');
                }
            };
        }

        const instancedMesh = new THREE.InstancedMesh(geometry, this.grassMaterial, count);

        for (let i = 0; i < count; i++) {
            const x = xMin + Math.random() * (xMax - xMin);
            const z = zMin + Math.random() * (zMax - zMin);
            const s = 0.6 + Math.random() * 1.2;

            dummy.position.set(x, 0, z);
            dummy.rotation.y = Math.random() * Math.PI;
            dummy.scale.set(s, s, s);
            dummy.updateMatrix();
            instancedMesh.setMatrixAt(i, dummy.matrix);
        }

        instancedMesh.castShadow = true;
        instancedMesh.receiveShadow = true;
        this.scene.add(instancedMesh);
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    render() {
        const time = performance.now() / 1000;
        this.grassMaterials.forEach(shader => {
            if (shader.uniforms.uTime) {
                shader.uniforms.uTime.value = time;
            }
        });
        // Post-Processing Render (Hyper Visuals)
        if (this.composer) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    updateBall(pos, quat) {
        if (this.ballMesh) {
            this.ballMesh.position.set(pos.x, pos.y, pos.z);
            this.ballMesh.quaternion.set(quat.x, quat.y, quat.z, quat.w);

            // Update Trail
            if (this.app && (this.app.state === 'flight' || this.app.state === 'putting')) {
                this.trailPoints.push(new THREE.Vector3(pos.x, pos.y, pos.z));
                if (this.trailPoints.length > 200) this.trailPoints.shift();
                this.trailGeometry.setFromPoints(this.trailPoints);
            } else {
                this.trailPoints = [];
                this.trailGeometry.setFromPoints([]);
            }
        }
    }

    setBallType(ballData) {
        if (!this.ballMesh) return;
        this.ballMesh.material.color.setHex(ballData.color);

        // Trail Color Sync
        if (ballData.name.includes('Golden')) {
            this.trailMaterial.color.setHex(0xffd700); // Gold
            this.trailMaterial.opacity = 1.0;
        } else if (ballData.name.includes('Pro')) {
            this.trailMaterial.color.setHex(0x00ffff); // Cyan
            this.trailMaterial.opacity = 0.8;
        } else {
            this.trailMaterial.color.setHex(0x00ff00); // Standard Green
            this.trailMaterial.opacity = 0.6;
        }
    }

    setCameraMode(mode) {
        if (mode === 'tee') {
            this.camera.position.set(0, 1.8, 8);
            this.camera.lookAt(0, 0.8, -50);
        } else if (mode === 'follow') {
            // Ball follow logic to be added
        }
    }
}
