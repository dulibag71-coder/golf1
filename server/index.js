import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { register, login } from './controllers/authController.js';
import { authenticateToken, authorizeAdmin } from './middleware/auth.js';
import { getAllUsers, getAllPayments, getStats } from './controllers/adminController.js';
import { createCheckout, completePayment } from './controllers/paymentController.js';
import { logSystemAction } from './utils/logger.js';
import db from './db/database.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:5173', 'http://localhost:3000'];

app.use(cors({
    origin: (origin, callback) => {
        // 운영 환경에서는 allowedOrigins에 포함된 경우만 허용
        if (!origin || allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
            callback(null, true);
        } else {
            callback(new Error('CORS 정책에 의해 차단되었습니다.'));
        }
    },
    credentials: true
}));
app.use(express.json());

// Health Check (for Load Balancer)
app.get('/api/health', (req, res) => {
    res.json({
        status: 'UP',
        timestamp: new Date().toISOString(),
        version: process.env.APP_VERSION || '1.0.0'
    });
});

// Public Routes
app.post('/api/auth/register', register);
app.post('/api/auth/login', login);

// Game Configuration (Server-side decision for items/settings)
app.get('/api/game/config', (req, res) => {
    // 실제 운영 환경에서는 사용자의 JWT를 확인하여 인벤토리 정보를 반환하겠지만,
    // 여기서는 '서버에서 결정하는' 로직을 시뮬레이션하기 위해 추천 아이템을 반환합니다.
    res.json({
        equippedBall: {
            id: 'premium_pro_ball',
            name: '서버 추천: Pro V1x',
            color: 0xffffff,
            physicsMod: { restitution: 0.8, friction: 0.2 }
        },
        env: {
            windSpeed: 2.5,
            weather: 'sunny'
        }
    });
});

// Protected Routes (Example)
app.get('/api/user/profile', authenticateToken, (req, res) => {
    db.get(`SELECT id, email, skill_level, subscription FROM users WHERE id = ?`, [req.user.id], (err, user) => {
        if (err || !user) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
        res.json(user);
    });
});

// Shot History API
app.post('/api/shots', authenticateToken, (req, res) => {
    const { clubId, ballSpeed, launchAngle, spinRate, carryDist, totalDist, envSettings } = req.body;
    const userId = req.user.id;

    const auditLog = {
        timestamp: new Date().toISOString(),
        userId, clubId, ballSpeed, launchAngle, spinRate, carryDist, totalDist,
        envSettings,
        engineVersion: 'v1.0-commercial'
    };

    db.run(
        `INSERT INTO shots (user_id, club_id, ball_speed, launch_angle, spin_rate, carry_dist, total_dist, env_settings)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, clubId, ballSpeed, launchAngle, spinRate, carryDist, totalDist, JSON.stringify(envSettings)],
        function (err) {
            if (err) return res.status(500).json({ message: '기록 저장 중 오류가 발생했습니다.' });

            // 시스템 로그에 샷 Audit 기록 (분쟁 발생 시 재현용)
            db.run(`INSERT INTO system_logs (user_id, action, details) VALUES (?, ?, ?)`,
                [userId, 'shot_audit', JSON.stringify(auditLog)]);

            res.status(201).json({ message: '샷 히스토리가 저장되었습니다.', shotId: this.lastID });
        }
    );
});

app.get('/api/shots/history', authenticateToken, (req, res) => {
    db.all(`SELECT * FROM shots WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`, [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ message: '데이터 조회 중 오류가 발생했습니다.' });
        res.json(rows);
    });
});

// --- 어드민 라우트 (관리자 전용) ---
app.get('/api/admin/users', authenticateToken, authorizeAdmin, getAllUsers);
app.get('/api/admin/payments', authenticateToken, authorizeAdmin, getAllPayments);
app.get('/api/admin/stats', authenticateToken, authorizeAdmin, getStats);

// --- 결제 라우트 ---
app.post('/api/payments/checkout', authenticateToken, createCheckout);
app.post('/api/payments/webhook', completePayment);

app.listen(PORT, () => {
    console.log(`AirSwing Backend Server running on http://localhost:${PORT}`);
});
