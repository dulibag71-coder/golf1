class MobileApp {
    constructor() {
        this.state = {
            user: 'User1',
            equippedBall: 'standard',
            gPoints: 12500
        };
        this.initEventListeners();
        this.startSync();
    }

    initEventListeners() {
        // --- 1. Remote Controller ---
        this.bindClick('btn-mulligan', () => this.sendAction('REMOTE', { command: 'mulligan' }));
        this.bindClick('btn-god-mode', () => this.sendAction('GOD_MODE', {}));
        this.bindClick('btn-cam-follow', () => this.sendAction('REMOTE', { command: 'camera', mode: 'follow' }));
        this.bindClick('btn-cam-top', () => this.sendAction('REMOTE', { command: 'camera', mode: 'top' }));

        // --- QR Login ---
        this.bindClick('qr-scan-btn', () => {
            alert('📷 QR 스캔 중... GolfUniverse 서버 인증...');
            setTimeout(() => {
                this.sendAction('QR_LOGIN', { userId: this.state.user, timestamp: Date.now() });
                alert('✅ GolfUniverse 로그인 성공!');
            }, 1000);
        });

        // --- 4. Equipment ---
        document.querySelectorAll('.equip-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const item = e.target.dataset.item;
                const name = e.target.innerText;
                this.equipItem(item, name);
            });
        });

        // --- 9. Caddy Settings ---
        this.bindChange('caddy-voice-select', (val) => this.sendAction('CADDY_SETTING', { voice: val }));

        // --- 11. Wind/Weather ---
        this.bindChange('wind-slider', (val) => this.sendAction('ENV_CONTROL', { type: 'wind', value: parseFloat(val) }));

        // Navigation
        document.querySelectorAll('.bottom-nav .item').forEach(item => {
            item.addEventListener('click', () => {
                document.querySelectorAll('.bottom-nav .item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                const tabName = item.dataset.tab;
                if (tabName) this.switchTab(tabName);
            });
        });
    }

    bindClick(id, handler) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', handler);
    }

    bindChange(id, handler) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', (e) => handler(e.target.value));
    }

    sendAction(type, payload) {
        const action = { type, payload, timestamp: Date.now() };
        localStorage.setItem('airswing_app_action', JSON.stringify(action)); // Local Bridge
        console.log(`[App -> Game] ${type}`, payload);
    }

    equipItem(itemId, itemName) {
        this.state.equippedBall = itemId;
        this.sendAction('EQUIP_ITEM', { itemId, itemName });
        // UI Feedback
        document.querySelectorAll('.equip-btn').forEach(b => b.style.borderColor = '#ddd');
        document.querySelector(`.equip-btn[data-item="${itemId}"]`).style.borderColor = 'var(--primary)';
        alert(`${itemName} 장착!`);
    }

    startSync() {
        setInterval(() => {
            const gameStateStr = localStorage.getItem('airswing_game_state');
            if (gameStateStr) {
                const gameState = JSON.parse(gameStateStr);
                this.updateDashboard(gameState);
            }
        }, 500);
    }

    updateDashboard(state) {
        // The 'state' object from localStorage might now contain a 'type' and 'payload'
        // to indicate specific events from the game.
        if (state.type) {
            switch (state.type) {
                case 'SHOT_DATA':
                    const data = state.payload; // Assuming payload contains shot data
                    // 샷 결과 반영 및 코인 업데이트
                    this.updateElement('val-distance', `${data.distance?.toFixed(1)} m`);
                    this.updateElement('val-speed', `${data.ballSpeed?.toFixed(1)} m/s`);
                    this.updateElement('val-launch', `${data.launchAngle?.toFixed(1)} °`);

                    if (data.rewardCoins) {
                        let currentCoins = parseInt(localStorage.getItem('g_coins')) || 0;
                        currentCoins += data.rewardCoins;
                        localStorage.setItem('g_coins', currentCoins);
                        // Ensure 'coin-amount' element exists in your HTML
                        this.updateElement('coin-amount', currentCoins.toLocaleString());
                    }
                    break;
                // Add other cases for different game state types if needed
                default:
                    console.log("Unhandled game state type:", state.type, state.payload);
                    break;
            }
        } else {
            // Fallback for older state structure or general updates
            // 3. Swing Data Dashboard
            if (state.lastShot) {
                this.updateElement('val-distance', `${state.lastShot.distance?.toFixed(1)} m`);
                this.updateElement('val-speed', `${state.lastShot.ballSpeed?.toFixed(1)} m/s`);
                this.updateElement('val-launch', `${state.lastShot.launchAngle?.toFixed(1)} °`);
            }
        }

        // 2. Real-time Scorecard
        if (state.score) {
            this.updateElement('val-total-score', `${state.score.total || 0}`);
        }
    }

    updateElement(id, text) {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
    }

    switchTab(tabName) {
        // Simple visibility toggle for demo purposes
        console.log('Switch tab:', tabName);
        // hide all sections... show target...
    }
}

// 아이템 샵 UI 주입 (데모용)
function injectShopUI() {
    const container = document.querySelector('.card-container');
    const shopHTML = `
        <div class="shop-section" style="background:white; margin-top:15px; padding:20px; border-radius:15px;">
            <h3 style="margin:0 0 15px 0;">🎒 내 가방 (장착/해제)</h3>
            <div style="display:flex; gap:10px;">
                <button class="equip-btn" data-item="standard" style="padding:10px; flex:1; border:1px solid #ddd; border-radius:10px; background:#f8f9fa;">⚪ 기본볼</button>
                <button class="equip-btn" data-item="pro" style="padding:10px; flex:1; border:1px solid #ddd; border-radius:10px; background:#f8f9fa;">⚪ 프로 (3pc)</button>
                <button class="equip-btn" data-item="premium" style="padding:10px; flex:1; border:1px solid gold; border-radius:10px; background:#fffbe6;">🟡 골든볼</button>
            </div>
        </div>
    `;
    container.innerHTML += shopHTML;
}

window.addEventListener('DOMContentLoaded', () => {
    injectShopUI();
    window.mobileApp = new MobileApp();
});
