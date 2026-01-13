/**
 * TerrainTypes.js
 * 지형 타입 및 물리 파라미터 정의
 */

export const TerrainType = {
    FAIRWAY: 'FAIRWAY',
    ROUGH: 'ROUGH',
    GREEN: 'GREEN',
    BUNKER: 'BUNKER',
    WATER: 'WATER', // Penalty Area
    OB: 'OB',
    TEE: 'TEE'
};

export const TerrainPhysics = {
    [TerrainType.FAIRWAY]: {
        friction: 0.4,
        restitution: 0.25,
        drag: 0.05 // 구름 저항
    },
    [TerrainType.ROUGH]: {
        friction: 0.9, // 매우 거침
        restitution: 0.1, // 잘 튀지 않음
        drag: 0.2 // 공이 금방 멈춤
    },
    [TerrainType.GREEN]: {
        friction: 0.15, // 매우 미끄러움
        restitution: 0.1,
        drag: 0.02
    },
    [TerrainType.BUNKER]: {
        friction: 3.0, // 모래 저항 (거의 박힘)
        restitution: 0.0, // 튀지 않음
        drag: 0.8
    },
    [TerrainType.WATER]: {
        friction: 0.0, // 물리적 의미 없음 (빠짐)
        restitution: 0.0,
        drag: 0.0
    },
    [TerrainType.OB]: {
        friction: 0.5,
        restitution: 0.5,
        drag: 0.05
    },
    [TerrainType.TEE]: {
        friction: 0.4,
        restitution: 0.25,
        drag: 0.05
    }
};
