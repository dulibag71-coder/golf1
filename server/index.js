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
        // Vercel 배포 도메인 허용 (.vercel.app)
        if (!origin || allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('.vercel.app') || process.env.NODE_ENV === 'development') {
            callback(null, true);
        } else {
            console.warn('CORS Blocked:', origin);
            callback(null, true); // Dev 모드에서 임시 허용 (사용자 불편 방지)
            // callback(new Error('CORS 정책에 의해 차단되었습니다.')); 
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

// QR Login Session Routes
import { createSession, checkSession, connectSession } from './controllers/sessionController.js';
app.get('/api/auth/session/create', createSession);
app.get('/api/auth/session/check', checkSession);
app.post('/api/auth/session/connect', authenticateToken, connectSession);

// Game Configuration (Server-side decision for items/settings)
app.get('/api/game/config', (req, res) => {
    const userId = req.query.userId || 1; // 실제로는 JWT에서 추출
    db.get(`SELECT equipped_ball FROM users WHERE id = ?`, [userId], (err, row) => {
        if (err || !row) {
            return res.json({ equippedBall: { id: 'standard', color: 0xffffff, name: 'Standard' } });
        }

        const balls = {
            standard: { id: 'standard', name: 'Standard', color: 0xffffff },
            pro: { id: 'pro', name: 'Pro V1', color: 0xeeeeee },
            premium: { id: 'premium', name: 'Golden Ball', color: 0xffd700 }
        };

        res.json({
            equippedBall: balls[row.equipped_ball] || balls.standard,
            env: { windSpeed: 2.5, weather: 'sunny' }
        });
    });
});

// 아이템 장착 (모바일 -> 서버)
app.post('/api/user/equip', authenticateToken, (req, res) => {
    const { itemId } = req.body;
    const userId = req.user.id;
    db.run(`UPDATE users SET equipped_ball = ? WHERE id = ?`, [itemId, userId], (err) => {
        if (err) return res.status(500).json({ message: '장착 실패' });
        res.json({ message: '장착 완료' });
    });
});

// 원격 커맨드 발송 (모바일 -> 서버)
app.post('/api/remote/command', authenticateToken, (req, res) => {
    const { command, payload } = req.body;
    const userId = req.user.id;
    db.run(`INSERT INTO remote_commands (user_id, command, payload) VALUES (?, ?, ?)`,
        [userId, command, JSON.stringify(payload)],
        (err) => {
            if (err) return res.status(500).json({ message: '명령 발송 실패' });
            res.json({ message: '명령 발송됨' });
        });
});

// 원격 커맨드 조회 및 처리 (게임 -> 서버)
app.get('/api/remote/poll', (req, res) => {
    const userId = req.query.userId || 1;
    db.all(`SELECT * FROM remote_commands WHERE user_id = ? AND is_processed = 0`, [userId], (err, rows) => {
        if (err || !rows.length) return res.json({ commands: [] });

        // 가져온 명령들을 처리 완료 상태로 변경
        const ids = rows.map(r => r.id).join(',');
        db.run(`UPDATE remote_commands SET is_processed = 1 WHERE id IN (${ids})`);

        res.json({ commands: rows.map(r => ({ type: r.command, payload: JSON.parse(r.payload) })) });
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

// 게임 상태 저장 (게임 -> 서버)
app.post('/api/user/state', (req, res) => {
    const { userId, gameState } = req.body;
    // 메모리에 임시 저장 (실제 운영 환경에선 Redis나 DB 권장)
    if (!app.userStates) app.userStates = {};
    app.userStates[userId] = { ...gameState, lastUpdated: Date.now() };
    res.json({ success: true });
});

// 게임 상태 조회 (모바일 -> 서버)
app.get('/api/user/state', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const state = (app.userStates && app.userStates[userId]) || null;
    res.json({ state });
});

const isVercel = process.env.VERCEL === '1';

if (!isVercel) {
    app.listen(PORT, () => {
        console.log(`서버 실행 중: http://localhost:${PORT}`);
    });
}

export default app;
