// VAD 对比测试页面逻辑
import { log } from './utils/logger.js';
import { getVADDetector } from './core/audio/vad.js';

class VadComparisonController {
    constructor() {
        // 现有 VAD
        this.legacyVad = null;

        // Silero VAD (使用 MicVAD)
        this.sileroVad = null;
        this.sileroThreshold = 0.5;

        // 状态
        this.isListening = false;
        this.legacyIsSpeaking = false;
        this.sileroIsSpeaking = false;

        // DOM 元素
        this.elements = {};

        // 初始化
        this.init();
    }

    async init() {
        this.cacheElements();
        this.bindEvents();
        this.setupLegacyVad();
        await this.initSileroVad();
    }

    cacheElements() {
        this.elements = {
            // 现有 VAD
            legacyVolumeFill: document.getElementById('legacyVolumeFill'),
            legacyVolumeValue: document.getElementById('legacyVolumeValue'),
            legacyThreshold: document.getElementById('legacyThreshold'),
            legacyThresholdSlider: document.getElementById('legacyThresholdSlider'),
            legacyThresholdValue: document.getElementById('legacyThresholdValue'),
            legacyStatus: document.getElementById('legacyStatus'),

            // Silero VAD
            sileroConfidenceFill: document.getElementById('sileroConfidenceFill'),
            sileroConfidenceValue: document.getElementById('sileroConfidenceValue'),
            sileroThreshold: document.getElementById('sileroThreshold'),
            sileroThresholdSlider: document.getElementById('sileroThresholdSlider'),
            sileroThresholdValue: document.getElementById('sileroThresholdValue'),
            sileroStatus: document.getElementById('sileroStatus'),
            sileroLoading: document.getElementById('sileroLoading'),

            // 记录
            recordContainer: document.getElementById('recordContainer'),
            clearRecordBtn: document.getElementById('clearRecordBtn'),

            // 控制按钮
            startBtn: document.getElementById('startBtn'),
            stopBtn: document.getElementById('stopBtn')
        };
    }

    bindEvents() {
        // 开始按钮
        this.elements.startBtn.addEventListener('click', () => this.startListening());

        // 停止按钮
        this.elements.stopBtn.addEventListener('click', () => this.stopListening());

        // 现有 VAD 阈值滑块
        this.elements.legacyThresholdSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.elements.legacyThresholdValue.textContent = value;
            if (this.legacyVad) {
                this.legacyVad.setVolumeThreshold(value);
                this.updateLegacyThresholdLine();
            }
        });

        // Silero VAD 阈值滑块
        this.elements.sileroThresholdSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value) / 100;
            this.sileroThreshold = value;
            this.elements.sileroThresholdValue.textContent = value.toFixed(2);
            this.updateSileroThresholdLine();
        });

        // 清空记录按钮
        this.elements.clearRecordBtn.addEventListener('click', () => this.clearRecords());
    }

    setupLegacyVad() {
        this.legacyVad = getVADDetector({
            volumeThreshold: 12,
            startDelay: 200,
            stopDelay: 1200
        });

        // 音量变化
        this.legacyVad.onVolumeChange = (volume) => {
            this.updateLegacyVolumeDisplay(volume);
        };

        // 说话状态变化
        this.legacyVad.onSpeakingChange = (isSpeaking, duration) => {
            if (this.legacyIsSpeaking !== isSpeaking) {
                this.legacyIsSpeaking = isSpeaking;
                const action = isSpeaking ? '开始说话' : '停止说话';
                this.addRecord('legacy', action);
            }
            this.updateLegacyStatus(isSpeaking);
        };

        this.updateLegacyThresholdLine();
    }

    async initSileroVad() {
        try {
            // 等待 MicVAD bundle 加载 (最多等待 5 秒)
            let retries = 50;
            while (typeof window.vad?.MicVAD === 'undefined' && retries > 0) {
                await new Promise(resolve => setTimeout(resolve, 100));
                retries--;
            }

            if (typeof window.vad?.MicVAD === 'undefined') {
                throw new Error('MicVAD 库未加载，请刷新页面重试');
            }

            this.elements.sileroLoading.classList.add('hidden');
            this.addRecord('system', '✅ MicVAD 准备就绪');
        } catch (error) {
            this.elements.sileroLoading.innerHTML = `<span style="color: #f44336;">❌ 加载失败: ${error.message}</span>`;
            console.error('MicVAD 初始化失败:', error);
        }
    }

    async startListening() {
        if (this.isListening) return;

        try {
            // 请求麦克风权限并启动现有 VAD
            await this.legacyVad.start();

            // 初始化并启动 Silero VAD (使用全局 vad.MicVAD)
            if (vad?.MicVAD && !this.sileroVad) {
                this.sileroVad = await vad.MicVAD.new({
                    onSpeechStart: () => {
                        if (!this.sileroIsSpeaking) {
                            this.sileroIsSpeaking = true;
                            this.addRecord('silero', '开始说话');
                        }
                        this.updateSileroStatus(true);
                    },
                    onSpeechEnd: () => {
                        if (this.sileroIsSpeaking) {
                            this.sileroIsSpeaking = false;
                            this.addRecord('silero', '停止说话');
                        }
                        this.updateSileroStatus(false);
                    }
                });
            }

            if (this.sileroVad) {
                this.sileroVad.start();
            }

            this.isListening = true;
            this.elements.startBtn.disabled = true;
            this.elements.stopBtn.disabled = false;

            this.addRecord('system', '🎤 已开始监听');

        } catch (error) {
            console.error('启动监听失败:', error);
            this.addRecord('system', `❌ 启动失败: ${error.message}`);
        }
    }

    stopListening() {
        // 停止现有 VAD
        if (this.legacyVad) {
            this.legacyVad.stop();
        }

        // 暂停 Silero VAD (保留实例，可以重新启动)
        if (this.sileroVad) {
            this.sileroVad.pause();
        }

        this.isListening = false;
        this.legacyIsSpeaking = false;
        this.sileroIsSpeaking = false;

        this.elements.startBtn.disabled = false;
        this.elements.stopBtn.disabled = true;

        this.updateLegacyStatus(false);
        this.updateSileroStatus(false);
        this.updateLegacyVolumeDisplay(0);

        this.addRecord('system', '⏹️ 已停止监听');
    }

    updateLegacyVolumeDisplay(volume) {
        this.elements.legacyVolumeFill.style.width = `${volume}%`;
        this.elements.legacyVolumeValue.textContent = Math.round(volume);

        const threshold = this.legacyVad?.volumeThreshold || 12;
        if (volume > threshold) {
            this.elements.legacyVolumeFill.classList.add('speaking');
        } else {
            this.elements.legacyVolumeFill.classList.remove('speaking');
        }
    }

    updateLegacyThresholdLine() {
        const threshold = this.legacyVad?.volumeThreshold || 12;
        this.elements.legacyThreshold.style.left = `${threshold}%`;
    }

    updateSileroThresholdLine() {
        this.elements.sileroThreshold.style.left = `${this.sileroThreshold * 100}%`;
    }

    updateSileroConfidence(prob) {
        const percentage = Math.round(prob * 100);
        this.elements.sileroConfidenceFill.style.width = `${percentage}%`;
        this.elements.sileroConfidenceValue.textContent = prob.toFixed(2);

        // 根据阈值判断是否显示 speaking 样式
        if (prob > this.sileroThreshold) {
            this.elements.sileroConfidenceFill.classList.add('speaking');
        } else {
            this.elements.sileroConfidenceFill.classList.remove('speaking');
        }
    }

    updateLegacyStatus(isSpeaking) {
        if (isSpeaking) {
            this.elements.legacyStatus.textContent = '🔊 说话中';
            this.elements.legacyStatus.className = 'status-value speaking';
        } else {
            this.elements.legacyStatus.textContent = '🔇 静音中';
            this.elements.legacyStatus.className = 'status-value silence';
        }
    }

    updateSileroStatus(isSpeaking) {
        if (isSpeaking) {
            this.elements.sileroStatus.textContent = '🔊 说话中';
            this.elements.sileroStatus.className = 'status-value speaking';
        } else {
            this.elements.sileroStatus.textContent = '🔇 静音中';
            this.elements.sileroStatus.className = 'status-value silence';
        }
    }

    addRecord(source, action) {
        if (!this.elements?.recordContainer) {
            console.error('recordContainer 为 null');
            return;
        }

        const timestamp = new Date().toLocaleTimeString('zh-CN', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        const entry = document.createElement('div');
        entry.className = 'record-entry';

        const actionClass = action.includes('开始') ? 'start' : action.includes('停止') ? 'stop' : '';

        let legacyContent = '-';
        let sileroContent = '-';

        if (source === 'legacy') {
            legacyContent = `<span class="${actionClass}">${action}</span>`;
        } else if (source === 'silero') {
            sileroContent = `<span class="${actionClass}">${action}</span>`;
        } else if (source === 'system') {
            // 系统消息显示在中间
            legacyContent = action;
            sileroContent = action;
        }

        entry.innerHTML = `
            <span class="col-time">${timestamp}</span>
            <span class="col-legacy">${legacyContent}</span>
            <span class="col-silero">${sileroContent}</span>
        `;

        this.elements.recordContainer.appendChild(entry);
        this.elements.recordContainer.scrollTop = this.elements.recordContainer.scrollHeight;
    }

    clearRecords() {
        this.elements.recordContainer.innerHTML = '<div class="record-entry">记录已清空</div>';
    }
}

// 初始化
window.vadComparisonController = new VadComparisonController();
