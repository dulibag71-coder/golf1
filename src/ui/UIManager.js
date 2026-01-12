import { AdminDashboard } from './AdminDashboard.js';
import { PaymentUI } from './PaymentUI.js';

export class UIManager {
    constructor(app) {
        this.app = app;
        this.initElements();
        this.bindEvents();
    }

    initElements() {
        this.hud = {
            targetDist: document.getElementById('target-dist'),
            windVal: document.getElementById('wind-val'),
            windArrow: document.getElementById('wind-arrow'),
            altVal: document.getElementById('alt-val'),
            clubName: document.getElementById('current-club-name')
        };

        this.shotResult = document.getElementById('shot-result');
        this.loader = document.getElementById('loader');
        this.loadBar = document.getElementById('load-bar');
        this.loadStatus = document.getElementById('load-status');
        this.loginOverlay = document.getElementById('login-overlay');

        // Rebrand Loader
        if (this.loader) {
            const logoEl = this.loader.querySelector('.logo');
            if (logoEl) logoEl.innerText = 'GOLF UNIVERSE';
        }

        this.readyStatus = document.getElementById('ready-status');
        this.addressGuide = document.getElementById('address-guide');
        this.adminMobileBtn = document.getElementById('admin-mobile-btn');

        this.admin = new AdminDashboard(this);
        this.payment = new PaymentUI(this);

        this.audioCtx = null;
    }

    bindEvents() {
        // 클럽 선택 휠 클릭 이벤트 (예시)
        document.getElementById('club-wheel').addEventListener('click', () => {
            console.log('클럽 변경 시퀀스 실행');
            // TODO: Club switching logic
        });

        window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'a') {
                this.showAdmin();
            }
        });

        if (this.adminMobileBtn) {
            this.adminMobileBtn.addEventListener('click', () => this.showAdmin());
        }
    }

    updateProgress(percent, statusText) {
        if (this.loadBar) this.loadBar.style.width = `${percent}%`;
        if (this.loadStatus && statusText) {
            this.loadStatus.innerText = statusText;
        }
    }

    hideLoader() {
        if (this.loader) {
            this.loader.style.opacity = '0';
            setTimeout(() => {
                this.loader.style.display = 'none';
                this.showLogin(); // 로딩 끝나면 로그인창 띄움
            }, 500);
        }
    }

    showLogin() {
        if (this.loginOverlay) {
            this.loginOverlay.style.display = 'flex';
        }
    }

    hideLogin() {
        if (this.loginOverlay) {
            this.loginOverlay.style.display = 'none';
        }
    }

    showShotResult(data) {
        this.shotResult.classList.remove('hidden');
        document.getElementById('res-ball-speed').innerText = data.ballSpeed.toFixed(1);
        document.getElementById('res-total').innerText = data.totalDist.toFixed(1);
        // ... 기타 데이터 업데이트
    }

    setMode(mode) {
        // pre-swing, flying, result, putting 등 상태에 따른 UI 변경
        if (mode === 'ready') {
            this.addressGuide.classList.remove('hidden');
            this.readyStatus.classList.add('hidden');
        } else if (mode === 'address') {
            this.addressGuide.classList.add('hidden');
            this.readyStatus.classList.remove('hidden');
            this.playReadySound();
        }
        else {
            this.addressGuide.classList.add('hidden');
            this.readyStatus.classList.add('hidden');
        }

        // 유저 권한에 따른 관리자 버튼 노출 처리
        this.checkAdminPrivilege();
    }

    checkAdminPrivilege() {
        const userStr = localStorage.getItem('user');
        if (userStr) {
            const user = JSON.parse(userStr);
            if (user.role === 'admin') {
                this.adminMobileBtn?.classList.remove('hidden');
            } else {
                this.adminMobileBtn?.classList.add('hidden');
            }
        } else {
            this.adminMobileBtn?.classList.add('hidden');
        }
    }

    playReadySound() {
        if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, this.audioCtx.currentTime); // A5 note

        gain.gain.setValueAtTime(0.2, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.3);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.3);
    }

    showAdmin() {
        this.admin.show();
    }

    showPayment() {
        this.payment.show();
    }

    showNotification(msg) {
        const toast = document.createElement('div');
        toast.style = 'position:fixed; bottom:100px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.8); color:white; padding:15px 30px; border-radius:30px; z-index:2000; font-weight:bold; border-left:5px solid var(--primary);';
        toast.innerText = `[GolfUniverse] ${msg}`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
}
