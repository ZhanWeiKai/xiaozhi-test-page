// VAD (Voice Activity Detection) 语音活动检测模块
import { log } from '../../utils/logger.js';

/**
 * VAD 检测器类
 * 用于检测用户是否在说话，并自动触发录音开始/停止
 */
export class VADDetector {
    constructor(options = {}) {
        // 可配置参数
        this.volumeThreshold = options.volumeThreshold ?? 30;    // 音量阈值 (0-100)
        this.startDelay = options.startDelay ?? 200;             // 开始触发延迟 (ms)
        this.stopDelay = options.stopDelay ?? 1000;              // 停止触发延迟 (ms)
        this.detectInterval = options.detectInterval ?? 50;      // 检测间隔 (ms)

        // 状态
        this.isListening = false;      // 是否在监听
        this.isSpeaking = false;       // 当前是否在说话（音量超过阈值）
        this.isRecording = false;      // 是否正在录音
        this.currentVolume = 0;        // 当前音量 (0-100)

        // 计时相关
        this.speakingStartTime = null; // 开始说话的时间戳
        this.silenceStartTime = null;  // 开始静音的时间戳
        this.speakingDuration = 0;     // 连续说话时长 (ms)
        this.silenceDuration = 0;      // 连续静音时长 (ms)

        // 音频相关
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.mediaStream = null;
        this.detectTimer = null;

        // 回调函数
        this.onVolumeChange = null;        // 音量变化回调 (volume) => {}
        this.onSpeakingChange = null;      // 说话状态变化回调 (isSpeaking, duration) => {}
        this.onSilenceChange = null;       // 静音状态变化回调 (duration) => {}
        this.onStartRecording = null;      // 触发开始录音回调 () => {}
        this.onStopRecording = null;       // 触发停止录音回调 () => {}
        this.onTriggerPredict = null;      // 触发预测回调 (prediction) => {}
        this.onError = null;               // 错误回调 (error) => {}
    }

    /**
     * 开始监听麦克风
     * @returns {Promise<boolean>} 是否成功开始
     */
    async start() {
        if (this.isListening) {
            log('VAD已在监听中', 'warning');
            return true;
        }

        try {
            // 获取麦克风流
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000,
                    channelCount: 1
                }
            });

            // 创建 AudioContext
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            // 创建分析器
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.8;

            // 连接麦克风
            this.microphone = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.microphone.connect(this.analyser);

            // 重置状态
            this.isListening = true;
            this.isSpeaking = false;
            this.isRecording = false;
            this.speakingStartTime = null;
            this.silenceStartTime = null;
            this.speakingDuration = 0;
            this.silenceDuration = 0;

            // 开始检测循环
            this._startDetection();

            log('VAD开始监听麦克风', 'success');
            return true;
        } catch (error) {
            log(`VAD启动失败: ${error.message}`, 'error');
            if (this.onError) {
                this.onError(error);
            }
            return false;
        }
    }

    /**
     * 停止监听
     */
    stop() {
        if (!this.isListening) {
            return;
        }

        // 停止检测循环
        if (this.detectTimer) {
            clearInterval(this.detectTimer);
            this.detectTimer = null;
        }

        // 释放音频资源
        if (this.microphone) {
            this.microphone.disconnect();
            this.microphone = null;
        }

        if (this.analyser) {
            this.analyser.disconnect();
            this.analyser = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        // 停止媒体流
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        // 重置状态
        this.isListening = false;
        this.isSpeaking = false;
        this.isRecording = false;
        this.speakingStartTime = null;
        this.silenceStartTime = null;
        this.speakingDuration = 0;
        this.silenceDuration = 0;
        this.currentVolume = 0;

        log('VAD停止监听', 'info');
    }

    /**
     * 设置音量阈值
     * @param {number} threshold 阈值 (0-100)
     */
    setVolumeThreshold(threshold) {
        this.volumeThreshold = Math.max(0, Math.min(100, threshold));
        log(`VAD阈值设置为: ${this.volumeThreshold}`, 'info');
    }

    /**
     * 设置开始触发延迟
     * @param {number} delay 延迟 (ms)
     */
    setStartDelay(delay) {
        this.startDelay = Math.max(50, Math.min(2000, delay));
    }

    /**
     * 设置停止触发延迟
     * @param {number} delay 延迟 (ms)
     */
    setStopDelay(delay) {
        this.stopDelay = Math.max(100, Math.min(5000, delay));
    }

    /**
     * 获取当前状态信息
     * @returns {Object} 状态信息
     */
    getState() {
        return {
            isListening: this.isListening,
            isSpeaking: this.isSpeaking,
            isRecording: this.isRecording,
            currentVolume: this.currentVolume,
            volumeThreshold: this.volumeThreshold,
            speakingDuration: this.speakingDuration,
            silenceDuration: this.silenceDuration,
            startDelay: this.startDelay,
            stopDelay: this.stopDelay
        };
    }

    /**
     * 开始检测循环
     * @private
     */
    _startDetection() {
        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

        this.detectTimer = setInterval(() => {
            if (!this.isListening) return;

            // 获取音量
            this.analyser.getByteFrequencyData(dataArray);
            this.currentVolume = this._calculateVolume(dataArray);

            // 触发音量变化回调
            if (this.onVolumeChange) {
                this.onVolumeChange(this.currentVolume);
            }

            // 检测逻辑
            this._detectVoiceActivity();

            // 更新触发预测
            this._updateTriggerPrediction();

        }, this.detectInterval);
    }

    /**
     * 计算音量 (0-100)
     * @param {Uint8Array} dataArray 频率数据
     * @returns {number} 音量值
     * @private
     */
    _calculateVolume(dataArray) {
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        // 将 0-255 映射到 0-100
        return Math.round((average / 255) * 100);
    }

    /**
     * 检测语音活动
     * @private
     */
    _detectVoiceActivity() {
        const now = Date.now();
        const isAboveThreshold = this.currentVolume > this.volumeThreshold;

        if (isAboveThreshold) {
            // 音量超过阈值
            this._handleSpeaking(now);
        } else {
            // 音量低于阈值
            this._handleSilence(now);
        }
    }

    /**
     * 处理说话状态
     * @param {number} now 当前时间戳
     * @private
     */
    _handleSpeaking(now) {
        // 重置静音计时
        this.silenceStartTime = null;
        this.silenceDuration = 0;

        if (!this.isSpeaking) {
            // 从静音变为说话
            this.isSpeaking = true;
            this.speakingStartTime = now;
            this.speakingDuration = 0;
            log(`VAD检测到说话，音量: ${this.currentVolume}`, 'info');

            if (this.onSpeakingChange) {
                this.onSpeakingChange(true, 0);
            }
        } else {
            // 持续说话
            this.speakingDuration = now - this.speakingStartTime;

            if (this.onSpeakingChange) {
                this.onSpeakingChange(true, this.speakingDuration);
            }
        }

        // 检查是否触发开始录音
        if (!this.isRecording && this.speakingDuration >= this.startDelay) {
            this._triggerStartRecording();
        }
    }

    /**
     * 处理静音状态
     * @param {number} now 当前时间戳
     * @private
     */
    _handleSilence(now) {
        // 重置说话计时
        this.speakingStartTime = null;
        this.speakingDuration = 0;

        if (this.isSpeaking) {
            // 从说话变为静音
            this.isSpeaking = false;
            this.silenceStartTime = now;
            this.silenceDuration = 0;
            log(`VAD检测到静音`, 'info');

            if (this.onSpeakingChange) {
                this.onSpeakingChange(false, 0);
            }
        }

        // 持续静音
        if (this.silenceStartTime) {
            this.silenceDuration = now - this.silenceStartTime;
        } else {
            this.silenceDuration = 0;
        }

        if (this.onSilenceChange) {
            this.onSilenceChange(this.silenceDuration);
        }

        // 检查是否触发停止录音
        if (this.isRecording && this.silenceDuration >= this.stopDelay) {
            this._triggerStopRecording();
        }
    }

    /**
     * 触发开始录音
     * @private
     */
    _triggerStartRecording() {
        this.isRecording = true;
        const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        log(`[${timestamp}] VAD触发【开始录音】`, 'success');

        if (this.onStartRecording) {
            this.onStartRecording();
        }
    }

    /**
     * 触发停止录音
     * @private
     */
    _triggerStopRecording() {
        this.isRecording = false;
        const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        log(`[${timestamp}] VAD触发【停止录音】`, 'success');

        if (this.onStopRecording) {
            this.onStopRecording();
        }
    }

    /**
     * 更新触发预测
     * @private
     */
    _updateTriggerPrediction() {
        if (!this.onTriggerPredict) return;

        const prediction = {
            // 开始录音预测
            startRecording: {
                willTrigger: this.isSpeaking && !this.isRecording,
                progress: this.isSpeaking ? Math.min(1, this.speakingDuration / this.startDelay) : 0,
                currentDuration: this.speakingDuration,
                requiredDuration: this.startDelay
            },
            // 停止录音预测
            stopRecording: {
                willTrigger: !this.isSpeaking && this.isRecording,
                progress: !this.isSpeaking && this.isRecording ? Math.min(1, this.silenceDuration / this.stopDelay) : 0,
                currentDuration: this.silenceDuration,
                requiredDuration: this.stopDelay
            }
        };

        this.onTriggerPredict(prediction);
    }
}

// 创建单例
let vadDetectorInstance = null;

/**
 * 获取 VAD 检测器单例
 * @param {Object} options 配置选项
 * @returns {VADDetector} VAD 检测器实例
 */
export function getVADDetector(options = {}) {
    // 每次都创建新实例，避免回调冲突
    vadDetectorInstance = new VADDetector(options);
    return vadDetectorInstance;
}
