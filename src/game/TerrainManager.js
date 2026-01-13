import { TerrainType, TerrainPhysics } from '../physics/TerrainTypes.js';

export class TerrainManager {
    constructor(sceneManager) {
        this.scene = sceneManager;
        // 맵 크기 (Three.js 월드 좌표 기준)
        this.worldSize = 800; // -400 ~ 400
        this.imageSize = 1024; // 1024x1024 해상도 가정

        this.heightData = null; // Float32Array
        this.masks = {
            [TerrainType.FAIRWAY]: null, // Uint8Array
            [TerrainType.ROUGH]: null,
            [TerrainType.WATER]: null,
            [TerrainType.OB]: null,
            [TerrainType.BUNKER]: null // 벙커 추가
        };

        this.isLoaded = false;
    }

    async init() {
        console.log('지형 데이터 로딩 시작...');
        try {
            // 1. Heightmap 로드
            this.heightData = await this.loadImageData('./assets/terrain/heightmap.png');

            // 2. 마스크 로드 (없으면 생성 or 기본값)
            this.masks[TerrainType.FAIRWAY] = await this.loadImageData('./assets/terrain/mask_fairway.png');
            this.masks[TerrainType.ROUGH] = await this.loadImageData('./assets/terrain/mask_rough.png');
            this.masks[TerrainType.WATER] = await this.loadImageData('./assets/terrain/mask_water.png');
            this.masks[TerrainType.OB] = await this.loadImageData('./assets/terrain/mask_ob.png');
            this.masks[TerrainType.BUNKER] = await this.loadImageData('./assets/terrain/mask_bunker.png');

            this.isLoaded = true;
            console.log('지형 데이터 로딩 완료');
        } catch (e) {
            console.warn('지형 이미지 로드 실패 (파일 없음?). 기본 평지/알고리즘 모드로 동작합니다.', e);
            // Fallback: Use Polygon data or proceed without detailed masks
        }
    }

    // 이미지 파일을 픽셀 데이터로 변환 (Canvas 사용) - 타임아웃 적용 버전
    loadImageData(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';

            // 1.5초 타임아웃 (이미지가 없거나 로딩이 너무 길어지면 무시)
            const timer = setTimeout(() => {
                console.warn(`Terrain Load Timeout: ${url}`);
                resolve(null);
            }, 1500);

            img.onload = () => {
                clearTimeout(timer);
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = this.imageSize; // 강제 리사이징 or img.width
                    canvas.height = this.imageSize;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, this.imageSize, this.imageSize);

                    // 흑백 데이터만 필요하므로 Red 채널만 사용
                    const imgData = ctx.getImageData(0, 0, this.imageSize, this.imageSize);
                    const data = new Uint8Array(this.imageSize * this.imageSize);

                    for (let i = 0; i < data.length; i++) {
                        data[i] = imgData.data[i * 4]; // R channel
                    }
                    resolve(data);
                } catch (e) {
                    console.error('Image Process Error:', e);
                    resolve(null);
                }
            };
            img.onerror = (e) => {
                clearTimeout(timer);
                console.warn(`Image Load Failed: ${url}`);
                resolve(null);
            };
            img.src = url;
        });
    }

    // 월드 좌표(x, z) -> 픽셀 좌표(px, py) 변환
    worldToPixel(x, z) {
        // 월드: -worldSize/2 ~ +worldSize/2
        // 픽셀: 0 ~ imageSize
        const halfSize = this.worldSize / 2;
        const u = (x + halfSize) / this.worldSize;
        const v = (z + halfSize) / this.worldSize; // z가 아래로 갈수록 증가? Three.js는 z가 화면 밖.
        // 이미지 좌표계 (0,0 상단좌측) vs 월드 좌표계 고려. 
        // 보통 z 증가 == 아래쪽(남쪽) == 이미지 y 증가

        const px = Math.floor(u * this.imageSize);
        const py = Math.floor(v * this.imageSize);
        return { px, py, valid: (px >= 0 && px < this.imageSize && py >= 0 && py < this.imageSize) };
    }

    getHeight(x, z) {
        if (!this.isLoaded || !this.heightData) return 0; // 평지

        const { px, py, valid } = this.worldToPixel(x, z);
        if (!valid) return 0;

        const index = py * this.imageSize + px;
        // 0~255 값을 실제 높이 -10m ~ 30m 등으로 매핑
        const val = this.heightData[index];
        return (val / 255) * 40 - 10; // 예: 0=-10m, 255=30m
    }

    getTerrainType(x, z) {
        if (!this.isLoaded) return TerrainType.FAIRWAY; // 로딩 전

        const { px, py, valid } = this.worldToPixel(x, z);
        if (!valid) return TerrainType.OB; // 맵 밖은 OB

        const index = py * this.imageSize + px;

        // 우선순위: OB > Water > Fairway > Rough
        // (흰색 255에 가까우면 해당 영역으로 판정)
        const THRESHOLD = 128;

        if (this.masks[TerrainType.OB] && this.masks[TerrainType.OB][index] > THRESHOLD) return TerrainType.OB;
        if (this.masks[TerrainType.WATER] && this.masks[TerrainType.WATER][index] > THRESHOLD) return TerrainType.WATER;
        if (this.masks[TerrainType.BUNKER] && this.masks[TerrainType.BUNKER][index] > THRESHOLD) return TerrainType.BUNKER;
        if (this.masks[TerrainType.FAIRWAY] && this.masks[TerrainType.FAIRWAY][index] > THRESHOLD) return TerrainType.FAIRWAY;
        if (this.masks[TerrainType.ROUGH] && this.masks[TerrainType.ROUGH][index] > THRESHOLD) return TerrainType.ROUGH;

        return TerrainType.ROUGH; // 기본값
    }

    // 물리 파라미터 반환
    getPhysicsParams(x, z) {
        const type = this.getTerrainType(x, z);
        return { type, ...TerrainPhysics[type] };
    }
}
