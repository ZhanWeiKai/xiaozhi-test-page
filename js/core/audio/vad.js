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

        // 预缓冲相关
        this.preBufferSize = options.preBufferSize ?? 1000;  // 预缓冲大小 (ms)
        this.sampleRate = 16000;  // 采样率
        this.pcmBuffer = null;    // 环形缓冲区
        this.bufferWriteIndex = 0;  // 写入位置
        this.bufferedSamples = 0;   // 已缓冲的样本数
        this.audioProcessor = null; // 音频处理器
        this.audioSourceNode = null; // 音频源节点

        // 回调函数
        this.onVolumeChange = null;        // 音量变化回调 (volume) => {}
        this.onSpeakingChange = null;      // 说话状态变化回调 (isSpeaking, duration) => {}
        this.onSilenceChange = null;       // 静音状态变化回调 (duration) => {}
        this.onStartRecording = null;      // 触发开始录音回调 () => {}
        this.onStopRecording = null;       // 触发停止录音回调 () => {}
        this.onBufferedAudio = null;       // 缓冲音频回调 (pcmData) => {} - 返回预缓冲的音频
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

            // 创建 AudioContext - 使用16kHz采样率以匹配Opus编码器
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000,
                latencyHint: 'interactive'
            });

            // 验证采样率
            log(`VAD AudioContext 采样率: ${this.audioContext.sampleRate}Hz`, 'info');
            if (this.audioContext.sampleRate !== 16000) {
                log(`警告: 浏览器不支持16kHz采样率，使用 ${this.audioContext.sampleRate}Hz`, 'warning');
            }

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

            // 初始化预缓冲区
            this.sampleRate = this.audioContext.sampleRate;
            const bufferSamples = Math.floor(this.sampleRate * this.preBufferSize / 1000);
            this.pcmBuffer = new Int16Array(bufferSamples);
            this.bufferWriteIndex = 0;
            this.bufferedSamples = 0;

            // 创建音频处理器用于采集PCM数据
            this._createAudioProcessor();

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

        // 释放音频处理器
        if (this.audioProcessor) {
            this.audioProcessor.disconnect();
            this.audioProcessor.onaudioprocess = null;
            this.audioProcessor = null;
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

        // 重置预缓冲
        this.pcmBuffer = null;
        this.bufferWriteIndex = 0;
        this.bufferedSamples = 0;

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
     * 创建音频处理器用于采集PCM数据
     * @private
     */
    _createAudioProcessor() {
        // 使用 ScriptProcessorNode 采集 PCM 数据
        // bufferSize: 4096 样本，在 16kHz 采样率下约 256ms
        const bufferSize = 4096;
        this.audioProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

        this.audioProcessor.onaudioprocess = (event) => {
            if (!this.isListening) return;

            const inputData = event.inputBuffer.getChannelData(0);
            this._bufferPCMData(inputData);
        };

        // 连接音频源到处理器（不连接到destination，避免回声）
        this.audioSourceNode = this.microphone;
        this.audioSourceNode.connect(this.audioProcessor);
        // 注意：ScriptProcessorNode需要连接到destination才能工作，但我们把音量设为0
        const silentGain = this.audioContext.createGain();
        silentGain.gain.value = 0;
        this.audioProcessor.connect(silentGain);
        silentGain.connect(this.audioContext.destination);

        log(`VAD音频处理器已创建，预缓冲大小: ${this.preBufferSize}ms`, 'info');
    }

    /**
     * 将PCM数据存入环形缓冲区
     * @param {Float32Array} float32Data 浮点音频数据
     * @private
     */
    _bufferPCMData(float32Data) {
        if (!this.pcmBuffer) return;

        // 将 Float32 (-1.0 ~ 1.0) 转换为 Int16 (-32768 ~ 32767)
        for (let i = 0; i < float32Data.length; i++) {
            const sample = Math.max(-1, Math.min(1, float32Data[i]));
            const int16Sample = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7FFF);

            this.pcmBuffer[this.bufferWriteIndex] = int16Sample;
            this.bufferWriteIndex = (this.bufferWriteIndex + 1) % this.pcmBuffer.length;

            if (this.bufferedSamples < this.pcmBuffer.length) {
                this.bufferedSamples++;
            }
        }

        // 【DEBUG LOG】打印 PCM 缓冲区统计信息
        if (this.bufferedSamples > 0) {
            let min = 32767, max = -32768, sum = 0;
            const checkCount = Math.min(100, this.bufferedSamples); // 采样前100个样本
            const startIndex = (this.bufferWriteIndex - checkCount + this.pcmBuffer.length) % this.pcmBuffer.length;
            for (let i = 0; i < checkCount; i++) {
                const idx = (startIndex + i) % this.pcmBuffer.length;
                const val = this.pcmBuffer[idx];
                if (val < min) min = val;
                if (val > max) max = val;
                sum += Math.abs(val);
            }
            const avgAbs = Math.round(sum / checkCount);
            console.log(`[VAD PCM缓冲区] 样本数:${this.bufferedSamples}, 写入位置:${this.bufferWriteIndex}, ` +
                `最近${checkCount}样本: min=${min}, max=${max}, 平均绝对值=${avgAbs}, ` +
                `音量估算=${Math.round(avgAbs / 32768 * 100)}%`);
        }
    }

    /**
     * 获取预缓冲的PCM数据
     * @returns {Int16Array|null} 预缓冲的PCM数据
     * @private
     */
    _getBufferedAudio() {
        if (!this.pcmBuffer || this.bufferedSamples === 0) {
            return null;
        }

        // 创建结果数组
        const result = new Int16Array(this.bufferedSamples);

        // 计算读取起始位置（环形缓冲区中最早的数据）
        const startIndex = (this.bufferWriteIndex - this.bufferedSamples + this.pcmBuffer.length) % this.pcmBuffer.length;

        // 从环形缓冲区复制数据
        for (let i = 0; i < this.bufferedSamples; i++) {
            const readIndex = (startIndex + i) % this.pcmBuffer.length;
            result[i] = this.pcmBuffer[readIndex];
        }

        log(`VAD提取预缓冲音频: ${this.bufferedSamples} 样本, ${(this.bufferedSamples / this.sampleRate * 1000).toFixed(0)}ms`, 'info');
        return result;
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

        // 先发送预缓冲的音频数据
        if (this.onBufferedAudio) {
            const bufferedData = this._getBufferedAudio();
            if (bufferedData) {
                log(`[${timestamp}] 发送预缓冲音频: ${bufferedData.length} 样本`, 'info');
                this.onBufferedAudio(bufferedData);
            }
        }

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
