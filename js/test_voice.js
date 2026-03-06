// 音量检测测试页面逻辑
import { log } from './utils/logger.js';
import { VADDetector, getVADDetector } from './core/audio/vad.js';

// 页面控制器
class TestVoiceController {
    constructor() {
        this.vad = getVADDetector();
        this.isListening = false;
        this.isAutoDetectEnabled = false;  // 自动录音检测开关

        // DOM 元素
        this.elements = {};

        // 初始化
        this.init();
    }

    /**
     * 初始化页面
     */
    init() {
        this.cacheElements();
        this.bindEvents();
        this.setupVADCallbacks();
        this.updateThresholdLine();
    }

    /**
     * 缓存 DOM 元素
     */
    cacheElements() {
        this.elements = {
            // 音量显示
            volumeBar: document.getElementById('volumeBar'),
            volumeFill: document.getElementById('volumeFill'),
            volumeValue: document.getElementById('volumeValue'),
            volumeThreshold: document.getElementById('volumeThreshold'),

            // 阈值控制
            thresholdSlider: document.getElementById('thresholdSlider'),
            thresholdValue: document.getElementById('thresholdValue'),

            // 状态显示
            currentStatus: document.getElementById('currentStatus'),
            speakingDuration: document.getElementById('speakingDuration'),
            silenceDuration: document.getElementById('silenceDuration'),
            recordingStatus: document.getElementById('recordingStatus'),

            // 触发预测 - 开始录音
            startThreshold: document.getElementById('startThreshold'),
            startDelay: document.getElementById('startDelay'),
            startProgress: document.getElementById('startProgress'),
            startProgressText: document.getElementById('startProgressText'),
            startPredictionStatus: document.getElementById('startPredictionStatus'),

            // 触发预测 - 停止录音
            stopThreshold: document.getElementById('stopThreshold'),
            stopDelay: document.getElementById('stopDelay'),
            stopProgress: document.getElementById('stopProgress'),
            stopProgressText: document.getElementById('stopProgressText'),
            stopPredictionStatus: document.getElementById('stopPredictionStatus'),

            // 触发提示
            triggerAlert: document.getElementById('triggerAlert'),

            // 参数配置
            startDelaySlider: document.getElementById('startDelaySlider'),
            startDelayValue: document.getElementById('startDelayValue'),
            stopDelaySlider: document.getElementById('stopDelaySlider'),
            stopDelayValue: document.getElementById('stopDelayValue'),

            // 日志
            logContainer: document.getElementById('logContainer'),
            clearLogBtn: document.getElementById('clearLogBtn'),

            // 控制按钮
            startBtn: document.getElementById('startBtn'),
            stopBtn: document.getElementById('stopBtn'),

            // 模拟录音按钮
            simulateRecordBtn: document.getElementById('simulateRecordBtn'),
            simulateStatus: document.getElementById('simulateStatus'),

            // 自动录音检测开关
            autoDetectToggle: document.getElementById('autoDetectToggle'),
            autoDetectLabel: document.getElementById('autoDetectLabel')
        };
    }

    /**
     * 绑定事件
     */
    bindEvents() {
        // 开始监听按钮
        this.elements.startBtn.addEventListener('click', () => this.startListening());

        // 停止监听按钮
        this.elements.stopBtn.addEventListener('click', () => this.stopListening());

        // 阈值滑块
        this.elements.thresholdSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.elements.thresholdValue.textContent = value;
            this.vad.setVolumeThreshold(value);
            this.updateThresholdLine();
            this.updatePredictionLabels();
        });

        // 开始延迟滑块
        this.elements.startDelaySlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.elements.startDelayValue.textContent = `${value} ms`;
            this.vad.setStartDelay(value);
            this.updatePredictionLabels();
        });

        // 停止延迟滑块
        this.elements.stopDelaySlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            this.elements.stopDelayValue.textContent = `${value} ms`;
            this.vad.setStopDelay(value);
            this.updatePredictionLabels();
        });

        // 清空日志按钮
        this.elements.clearLogBtn.addEventListener('click', () => this.clearLog());

        // 自动录音检测开关
        this.elements.autoDetectToggle.addEventListener('change', (e) => {
            this.toggleAutoDetect(e.target.checked);
        });

        // 模拟录音按钮点击（仅在自动检测关闭时有效）
        this.elements.simulateRecordBtn.addEventListener('click', () => {
            if (!this.isAutoDetectEnabled && this.isListening) {
                this.manualToggleRecord();
            }
        });
    }

    /**
     * 设置 VAD 回调
     */
    setupVADCallbacks() {
        // 音量变化回调
        this.vad.onVolumeChange = (volume) => {
            this.updateVolumeDisplay(volume);
        };

        // 说话状态变化回调
        this.vad.onSpeakingChange = (isSpeaking, duration) => {
            this.updateSpeakingStatus(isSpeaking, duration);
        };

        // 静音状态变化回调
        this.vad.onSilenceChange = (duration) => {
            this.updateSilenceStatus(duration);
        };

        // 触发开始录音回调
        this.vad.onStartRecording = () => {
            this.onTriggerStartRecording();
        };

        // 触发停止录音回调
        this.vad.onStopRecording = () => {
            this.onTriggerStopRecording();
        };

        // 触发预测回调
        this.vad.onTriggerPredict = (prediction) => {
            this.updateTriggerPrediction(prediction);
        };

        // 错误回调
        this.vad.onError = (error) => {
            this.addLog(`错误: ${error.message}`, 'error');
        };
    }

    /**
     * 开始监听
     */
    async startListening() {
        this.addLog('正在请求麦克风权限...', 'info');

        const success = await this.vad.start();

        if (success) {
            this.isListening = true;
            this.elements.startBtn.disabled = true;
            this.elements.stopBtn.disabled = false;

            this.updateCurrentStatus('listening', '🎧 监听中', '正在检测音量...');
            this.addLog('开始监听麦克风', 'success');
        } else {
            this.addLog('启动监听失败，请检查麦克风权限', 'error');
        }
    }

    /**
     * 停止监听
     */
    stopListening() {
        this.vad.stop();
        this.isListening = false;

        this.elements.startBtn.disabled = false;
        this.elements.stopBtn.disabled = true;

        this.updateCurrentStatus('stopped', '🔇 已停止', '等待开始');
        this.updateVolumeDisplay(0);
        this.updateSpeakingStatus(false, 0);
        this.updateSilenceStatus(0);
        this.updateRecordingStatus(false);

        // 重置预测显示
        this.elements.startProgress.style.width = '0%';
        this.elements.startProgressText.textContent = '0 / 0 ms';
        this.elements.startPredictionStatus.textContent = '等待开始监听...';
        this.elements.startPredictionStatus.classList.remove('will-trigger');

        this.elements.stopProgress.style.width = '0%';
        this.elements.stopProgressText.textContent = '0 / 0 ms';
        this.elements.stopPredictionStatus.textContent = '需要先开始录音';
        this.elements.stopPredictionStatus.classList.remove('will-trigger');

        // 隐藏触发提示
        this.elements.triggerAlert.classList.remove('show', 'start', 'stop');

        // 重置模拟按钮
        this.resetSimulateButton();

        this.addLog('停止监听', 'info');
    }

    /**
     * 重置模拟按钮
     */
    resetSimulateButton() {
        const btn = this.elements.simulateRecordBtn;
        const status = this.elements.simulateStatus;

        btn.innerHTML = `
            <span class="btn-icon">🎤</span>
            <span class="btn-text">开始录音</span>
        `;
        btn.classList.remove('stop');
        btn.classList.add('start');

        status.innerHTML = `
            <span class="status-indicator"></span>
            <span class="status-text">等待说话...</span>
        `;
    }

    /**
     * 更新音量显示
     */
    updateVolumeDisplay(volume) {
        // 更新音量条
        this.elements.volumeFill.style.width = `${volume}%`;

        // 更新音量值
        this.elements.volumeValue.textContent = volume;

        // 根据音量改变颜色
        const threshold = this.vad.volumeThreshold;
        if (volume > threshold) {
            this.elements.volumeFill.classList.add('speaking');
        } else {
            this.elements.volumeFill.classList.remove('speaking');
        }
    }

    /**
     * 更新阈值线位置
     */
    updateThresholdLine() {
        const threshold = this.vad.volumeThreshold;
        this.elements.volumeThreshold.style.left = `${threshold}%`;
    }

    /**
     * 更新说话状态
     */
    updateSpeakingStatus(isSpeaking, duration) {
        this.elements.speakingDuration.textContent = `${Math.round(duration)} ms`;

        if (this.isListening) {
            if (isSpeaking) {
                this.updateCurrentStatus('speaking', '🔊 说话中', `音量 > ${this.vad.volumeThreshold}`);
            } else {
                this.updateCurrentStatus('silence', '🔇 静音中', `音量 < ${this.vad.volumeThreshold}`);
            }
        }
    }

    /**
     * 更新静音状态
     */
    updateSilenceStatus(duration) {
        this.elements.silenceDuration.textContent = `${Math.round(duration)} ms`;
    }

    /**
     * 更新录音状态
     */
    updateRecordingStatus(isRecording) {
        if (isRecording) {
            this.elements.recordingStatus.textContent = '🔴 录音中';
            this.elements.recordingStatus.style.color = '#f44336';
        } else {
            this.elements.recordingStatus.textContent = '未录音';
            this.elements.recordingStatus.style.color = '#333';
        }
    }

    /**
     * 更新当前状态显示
     */
    updateCurrentStatus(state, icon, text) {
        this.elements.currentStatus.innerHTML = `
            <span class="status-icon">${icon.split(' ')[0]}</span>
            <span class="status-text">${icon.split(' ')[1] || ''} ${text}</span>
        `;
    }

    /**
     * 更新触发预测
     */
    updateTriggerPrediction(prediction) {
        const start = prediction.startRecording;
        const stop = prediction.stopRecording;

        // 更新开始录音预测
        const startProgress = Math.round(start.progress * 100);
        this.elements.startProgress.style.width = `${startProgress}%`;
        this.elements.startProgressText.textContent = `${Math.round(start.currentDuration)} / ${start.requiredDuration} ms`;

        if (start.willTrigger && !this.vad.isRecording) {
            this.elements.startProgress.classList.add('warning');
            this.elements.startPredictionStatus.textContent = '⚡ 即将触发开始录音!';
            this.elements.startPredictionStatus.classList.add('will-trigger');
        } else {
            this.elements.startProgress.classList.remove('warning');
            if (this.vad.isRecording) {
                this.elements.startPredictionStatus.textContent = '已触发，录音中...';
            } else {
                this.elements.startPredictionStatus.textContent = '等待说话...';
            }
            this.elements.startPredictionStatus.classList.remove('will-trigger');
        }

        // 更新停止录音预测
        const stopProgress = Math.round(stop.progress * 100);
        this.elements.stopProgress.style.width = `${stopProgress}%`;
        this.elements.stopProgressText.textContent = `${Math.round(stop.currentDuration)} / ${stop.requiredDuration} ms`;

        if (stop.willTrigger) {
            this.elements.stopProgress.classList.add('danger');
            this.elements.stopPredictionStatus.textContent = '⚡ 即将触发停止录音!';
            this.elements.stopPredictionStatus.classList.add('will-trigger');
        } else {
            this.elements.stopProgress.classList.remove('danger');
            if (this.vad.isRecording) {
                this.elements.stopPredictionStatus.textContent = '录音中，等待静音...';
            } else {
                this.elements.stopPredictionStatus.textContent = '需要先开始录音';
            }
            this.elements.stopPredictionStatus.classList.remove('will-trigger');
        }

        // 更新触发提示
        this.updateTriggerAlert(prediction);
    }

    /**
     * 更新触发提示
     */
    updateTriggerAlert(prediction) {
        const alertEl = this.elements.triggerAlert;

        if (prediction.startRecording.willTrigger && !this.vad.isRecording) {
            alertEl.textContent = '⚡ 即将触发【开始录音】';
            alertEl.className = 'trigger-alert show start';
        } else if (prediction.stopRecording.willTrigger) {
            alertEl.textContent = '⚡ 即将触发【停止录音】';
            alertEl.className = 'trigger-alert show stop';
        } else {
            alertEl.classList.remove('show', 'start', 'stop');
        }
    }

    /**
     * 更新预测标签
     */
    updatePredictionLabels() {
        const threshold = this.vad.volumeThreshold;
        const startDelay = this.vad.startDelay;
        const stopDelay = this.vad.stopDelay;

        this.elements.startThreshold.textContent = threshold;
        this.elements.startDelay.textContent = startDelay;
        this.elements.stopThreshold.textContent = threshold;
        this.elements.stopDelay.textContent = stopDelay;
    }

    /**
     * 触发开始录音
     */
    onTriggerStartRecording() {
        // 只有在自动检测开启时才自动更新按钮
        if (this.isAutoDetectEnabled) {
            this.updateRecordingStatus(true);
            this.updateSimulateButton(true);
            this.addLog('✅ VAD自动触发【开始录音】', 'trigger-start');
        }
    }

    /**
     * 触发停止录音
     */
    onTriggerStopRecording() {
        // 只有在自动检测开启时才自动更新按钮
        if (this.isAutoDetectEnabled) {
            this.updateRecordingStatus(false);
            this.updateSimulateButton(false);
            this.addLog('✅ VAD自动触发【停止录音】', 'trigger-stop');
        }
    }

    /**
     * 切换自动录音检测
     * @param {boolean} enabled 是否开启
     */
    toggleAutoDetect(enabled) {
        this.isAutoDetectEnabled = enabled;
        const label = this.elements.autoDetectLabel;
        const btn = this.elements.simulateRecordBtn;

        if (enabled) {
            label.textContent = '自动录音检测: 开启';
            label.classList.add('active');
            // 开启时按钮不可点击
            btn.style.cursor = 'default';
            btn.style.opacity = '0.8';
            this.addLog('自动录音检测已开启', 'success');
        } else {
            label.textContent = '自动录音检测: 关闭';
            label.classList.remove('active');
            // 关闭时按钮可点击
            btn.style.cursor = 'pointer';
            btn.style.opacity = '1';
            this.addLog('自动录音检测已关闭，可手动点击按钮', 'info');
        }
    }

    /**
     * 手动切换录音状态（自动检测关闭时使用）
     */
    manualToggleRecord() {
        const isRecording = this.elements.simulateRecordBtn.classList.contains('stop');
        if (isRecording) {
            this.updateRecordingStatus(false);
            this.updateSimulateButton(false);
            this.addLog('👆 手动点击【停止录音】', 'trigger-stop');
        } else {
            this.updateRecordingStatus(true);
            this.updateSimulateButton(true);
            this.addLog('👆 手动点击【开始录音】', 'trigger-start');
        }
    }

    /**
     * 更新模拟录音按钮状态
     * @param {boolean} isRecording 是否在录音
     */
    updateSimulateButton(isRecording) {
        const btn = this.elements.simulateRecordBtn;
        const status = this.elements.simulateStatus;

        if (isRecording) {
            // 切换到停止录音状态
            btn.innerHTML = `
                <span class="btn-icon">⏹️</span>
                <span class="btn-text">停止录音</span>
            `;
            btn.classList.remove('start');
            btn.classList.add('stop');

            // 更新状态文字
            status.innerHTML = `
                <span class="status-indicator recording"></span>
                <span class="status-text highlight">✅ 已自动点击【开始录音】按钮</span>
            `;
        } else {
            // 切换到开始录音状态
            btn.innerHTML = `
                <span class="btn-icon">🎤</span>
                <span class="btn-text">开始录音</span>
            `;
            btn.classList.remove('stop');
            btn.classList.add('start');

            // 更新状态文字
            status.innerHTML = `
                <span class="status-indicator"></span>
                <span class="status-text highlight">✅ 已自动点击【停止录音】按钮</span>
            `;
        }
    }

    /**
     * 添加日志
     */
    addLog(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString('zh-CN', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3
        });

        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${type}`;
        logEntry.textContent = `[${timestamp}] ${message}`;

        this.elements.logContainer.appendChild(logEntry);
        this.elements.logContainer.scrollTop = this.elements.logContainer.scrollHeight;
    }

    /**
     * 清空日志
     */
    clearLog() {
        this.elements.logContainer.innerHTML = '<div class="log-entry log-info">日志已清空</div>';
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    window.testVoiceController = new TestVoiceController();
});
