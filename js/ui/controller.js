// UI控制模块
import { loadConfig, saveConfig } from '../config/manager.js';
import { getAudioRecorder } from '../core/audio/recorder.js';
import { getWebSocketHandler } from '../core/network/websocket.js';
import { getAudioPlayer } from '../core/audio/player.js';
import { log } from '../utils/logger.js';

// UI控制器类
export class UIController {
    constructor() {
        this.isEditing = false;
        this.visualizerCanvas = null;
        this.visualizerContext = null;
        this.audioStatsTimer = null;
        this.isAutoRecordEnabled = false;  // 自动录音检测开关

        // Silero VAD 相关状态
        this.sileroVad = null;                    // MicVAD 实例
        this.sileroIsSpeaking = false;            // 当前是否在说话
        this.sileroLowConfidenceFrames = 0;       // 连续低置信度帧计数器
        this.sileroForceStopThreshold = 10;       // 连续10帧(~200ms)低于阈值强制停止

        // 预缓冲相关
        this.preBufferSize = 1000;                // 预缓冲大小 (ms)
        this.pcmBuffer = null;                    // 环形缓冲区
        this.bufferWriteIndex = 0;                // 写入位置
        this.bufferedSamples = 0;                 // 已缓冲的样本数
        this.audioContext = null;                 // AudioContext
        this.audioProcessor = null;               // 音频处理器
        this.mediaStream = null;                  // 媒体流
    }

    // 初始化
    init() {
        this.visualizerCanvas = document.getElementById('audioVisualizer');
        this.visualizerContext = this.visualizerCanvas.getContext('2d');

        this.initVisualizer();
        this.initEventListeners();
        this.startAudioStatsMonitor();
        loadConfig();
    }

    // 初始化可视化器
    initVisualizer() {
        this.visualizerCanvas.width = this.visualizerCanvas.clientWidth;
        this.visualizerCanvas.height = this.visualizerCanvas.clientHeight;
        this.visualizerContext.fillStyle = '#fafafa';
        this.visualizerContext.fillRect(0, 0, this.visualizerCanvas.width, this.visualizerCanvas.height);
    }

    // 更新状态显示
    updateStatusDisplay(element, text) {
        element.textContent = text;
        element.removeAttribute('style');
        element.classList.remove('connected');
        if (text.includes('已连接')) {
            element.classList.add('connected');
        }
        console.log('更新状态:', text, '类列表:', element.className, '样式属性:', element.getAttribute('style'));
    }

    // 更新连接状态UI
    updateConnectionUI(isConnected) {
        const connectionStatus = document.getElementById('connectionStatus');
        const otaStatus = document.getElementById('otaStatus');
        const connectButton = document.getElementById('connectButton');
        const messageInput = document.getElementById('messageInput');
        const sendTextButton = document.getElementById('sendTextButton');
        const recordButton = document.getElementById('recordButton');

        if (isConnected) {
            this.updateStatusDisplay(connectionStatus, '● WS已连接');
            this.updateStatusDisplay(otaStatus, '● OTA已连接');
            connectButton.textContent = '断开';
            messageInput.disabled = false;
            sendTextButton.disabled = false;
            recordButton.disabled = false;
        } else {
            this.updateStatusDisplay(connectionStatus, '● WS未连接');
            this.updateStatusDisplay(otaStatus, '● OTA未连接');
            connectButton.textContent = '连接';
            messageInput.disabled = true;
            sendTextButton.disabled = true;
            recordButton.disabled = true;
            // 断开连接时，会话状态变为离线
            this.updateSessionStatus(null);
        }
    }

    // 更新录音按钮状态
    updateRecordButtonState(isRecording, seconds = 0) {
        const recordButton = document.getElementById('recordButton');
        if (isRecording) {
            recordButton.textContent = `停止录音 ${seconds.toFixed(1)}秒`;
            recordButton.classList.add('recording');
        } else {
            recordButton.textContent = '开始录音';
            recordButton.classList.remove('recording');
        }
        recordButton.disabled = false;
    }

    // 更新会话状态UI
    updateSessionStatus(isSpeaking) {
        const sessionStatus = document.getElementById('sessionStatus');
        if (!sessionStatus) return;

        // 保留背景元素
        const bgHtml = '<span id="sessionStatusBg" style="position: absolute; left: 0; top: 0; bottom: 0; width: 0%; background: linear-gradient(90deg, rgba(76, 175, 80, 0.2), rgba(33, 150, 243, 0.2)); transition: width 0.15s ease-out, background 0.3s ease; z-index: 0; border-radius: 20px;"></span>';

        if (isSpeaking === null) {
            // 离线状态
            sessionStatus.innerHTML = bgHtml + '<span style="position: relative; z-index: 1;"><span class="emoji-large">😶</span> 小智离线中</span>';
            sessionStatus.className = 'status offline';
        } else if (isSpeaking) {
            // 说话中
            sessionStatus.innerHTML = bgHtml + '<span style="position: relative; z-index: 1;"><span class="emoji-large">😶</span> 小智说话中</span>';
            sessionStatus.className = 'status speaking';
        } else {
            // 聆听中
            sessionStatus.innerHTML = bgHtml + '<span style="position: relative; z-index: 1;"><span class="emoji-large">😶</span> 小智聆听中</span>';
            sessionStatus.className = 'status listening';
        }
    }

    // 更新会话表情
    updateSessionEmotion(emoji) {
        const sessionStatus = document.getElementById('sessionStatus');
        if (!sessionStatus) return;

        // 获取当前文本内容，提取非表情部分
        let currentText = sessionStatus.textContent;
        // 移除现有的表情符号
        currentText = currentText.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();

        // 保留背景元素
        const bgHtml = '<span id="sessionStatusBg" style="position: absolute; left: 0; top: 0; bottom: 0; width: 0%; background: linear-gradient(90deg, rgba(76, 175, 80, 0.2), rgba(33, 150, 243, 0.2)); transition: width 0.15s ease-out, background 0.3s ease; z-index: 0; border-radius: 20px;"></span>';

        // 使用 innerHTML 添加带样式的表情
        sessionStatus.innerHTML = bgHtml + `<span style="position: relative; z-index: 1;"><span class="emoji-large">${emoji}</span> ${currentText}</span>`;
    }

    // 更新音频统计信息
    updateAudioStats() {
        const audioPlayer = getAudioPlayer();
        const stats = audioPlayer.getAudioStats();

        const sessionStatus = document.getElementById('sessionStatus');
        const sessionStatusBg = document.getElementById('sessionStatusBg');

        // 只在说话状态下显示背景进度
        if (sessionStatus && sessionStatus.classList.contains('speaking') && sessionStatusBg) {
            if (stats.pendingPlay > 0) {
                // 计算进度：5包=50%，10包及以上=100%
                let percentage;
                if (stats.pendingPlay >= 10) {
                    percentage = 100;
                } else {
                    percentage = (stats.pendingPlay / 10) * 100;
                }

                sessionStatusBg.style.width = `${percentage}%`;

                // 根据缓冲量改变背景颜色
                if (stats.pendingPlay < 5) {
                    // 缓冲不足：橙红色半透明
                    sessionStatusBg.style.background = 'linear-gradient(90deg, rgba(255, 152, 0, 0.25), rgba(255, 87, 34, 0.25))';
                } else if (stats.pendingPlay < 10) {
                    // 一般：黄绿色半透明
                    sessionStatusBg.style.background = 'linear-gradient(90deg, rgba(205, 220, 57, 0.25), rgba(76, 175, 80, 0.25))';
                } else {
                    // 充足：绿蓝色半透明
                    sessionStatusBg.style.background = 'linear-gradient(90deg, rgba(76, 175, 80, 0.25), rgba(33, 150, 243, 0.25))';
                }
            } else {
                // 没有缓冲，隐藏背景
                sessionStatusBg.style.width = '0%';
            }
        } else {
            // 非说话状态，隐藏背景
            if (sessionStatusBg) {
                sessionStatusBg.style.width = '0%';
            }
        }
    }

    // 启动音频统计监控
    startAudioStatsMonitor() {
        // 每100ms更新一次音频统计
        this.audioStatsTimer = setInterval(() => {
            this.updateAudioStats();
        }, 100);
    }

    // 停止音频统计监控
    stopAudioStatsMonitor() {
        if (this.audioStatsTimer) {
            clearInterval(this.audioStatsTimer);
            this.audioStatsTimer = null;
        }
    }

    // 绘制音频可视化效果
    drawVisualizer(dataArray) {
        this.visualizerContext.fillStyle = '#fafafa';
        this.visualizerContext.fillRect(0, 0, this.visualizerCanvas.width, this.visualizerCanvas.height);

        const barWidth = (this.visualizerCanvas.width / dataArray.length) * 2.5;
        let barHeight;
        let x = 0;

        for (let i = 0; i < dataArray.length; i++) {
            barHeight = dataArray[i] / 2;

            // 创建渐变色：从紫色到蓝色到青色
            const hue = 200 + (barHeight / this.visualizerCanvas.height) * 60; // 200-260度，从青色到紫色
            const saturation = 80 + (barHeight / this.visualizerCanvas.height) * 20; // 饱和度 80-100%
            const lightness = 45 + (barHeight / this.visualizerCanvas.height) * 15; // 亮度 45-60%

            this.visualizerContext.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
            this.visualizerContext.fillRect(x, this.visualizerCanvas.height - barHeight, barWidth, barHeight);

            x += barWidth + 1;
        }
    }

    // 初始化事件监听器
    initEventListeners() {
        const wsHandler = getWebSocketHandler();
        const audioRecorder = getAudioRecorder();

        // 设置WebSocket回调
        wsHandler.onConnectionStateChange = (isConnected) => {
            this.updateConnectionUI(isConnected);
        };

        wsHandler.onRecordButtonStateChange = (isRecording) => {
            this.updateRecordButtonState(isRecording);
        };

        wsHandler.onSessionStateChange = (isSpeaking) => {
            this.updateSessionStatus(isSpeaking);
        };

        wsHandler.onSessionEmotionChange = (emoji) => {
            this.updateSessionEmotion(emoji);
        };

        // 设置录音器回调
        audioRecorder.onRecordingStart = (seconds) => {
            this.updateRecordButtonState(true, seconds);
        };

        audioRecorder.onRecordingStop = () => {
            this.updateRecordButtonState(false);
        };

        audioRecorder.onVisualizerUpdate = (dataArray) => {
            this.drawVisualizer(dataArray);
        };

        // 连接按钮
        const connectButton = document.getElementById('connectButton');
        let isConnecting = false;

        const handleConnect = async () => {
            if (isConnecting) return;

            if (wsHandler.isConnected()) {
                wsHandler.disconnect();
            } else {
                isConnecting = true;
                await wsHandler.connect();
                isConnecting = false;
            }
        };

        connectButton.addEventListener('click', handleConnect);

        // 设备配置面板编辑/确定切换
        const toggleButton = document.getElementById('toggleConfig');
        const deviceMacInput = document.getElementById('deviceMac');
        const deviceNameInput = document.getElementById('deviceName');
        const clientIdInput = document.getElementById('clientId');
        const tokenInput = document.getElementById('token');

        toggleButton.addEventListener('click', () => {
            this.isEditing = !this.isEditing;

            deviceMacInput.disabled = !this.isEditing;
            deviceNameInput.disabled = !this.isEditing;
            clientIdInput.disabled = !this.isEditing;
            tokenInput.disabled = !this.isEditing;

            toggleButton.textContent = this.isEditing ? '确定' : '编辑';

            if (!this.isEditing) {
                saveConfig();
            }
        });

        // 标签页切换
        const tabs = document.querySelectorAll('.tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

                tab.classList.add('active');
                const tabContent = document.getElementById(`${tab.dataset.tab}Tab`);
                tabContent.classList.add('active');

                if (tab.dataset.tab === 'voice') {
                    setTimeout(() => {
                        this.initVisualizer();
                    }, 50);
                }
            });
        });

        // 发送文本消息
        const messageInput = document.getElementById('messageInput');
        const sendTextButton = document.getElementById('sendTextButton');

        const sendMessage = () => {
            const message = messageInput.value.trim();
            if (message && wsHandler.sendTextMessage(message)) {
                messageInput.value = '';
            }
        };

        sendTextButton.addEventListener('click', sendMessage);
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });

        // 录音按钮
        const recordButton = document.getElementById('recordButton');
        recordButton.addEventListener('click', () => {
            // 自动录音开启时，禁止手动点击
            if (this.isAutoRecordEnabled) return;

            if (audioRecorder.isRecording) {
                audioRecorder.stop();
            } else {
                audioRecorder.start();
            }
        });

        // 自动录音检测开关
        const autoRecordToggle = document.getElementById('autoRecordToggle');
        if (autoRecordToggle) {
            autoRecordToggle.addEventListener('change', (e) => {
                this.toggleAutoRecord(e.target.checked);
            });
        }

        // 窗口大小变化
        window.addEventListener('resize', () => this.initVisualizer());
    }

    // 切换自动录音检测
    async toggleAutoRecord(enabled) {
        this.isAutoRecordEnabled = enabled;

        if (enabled) {
            // 开启自动录音检测
            await this.startVAD();
        } else {
            // 关闭自动录音检测
            this.stopVAD();
        }
    }

    // 启动VAD检测 (使用 Silero VAD + 预缓冲)
    async startVAD() {
        const audioRecorder = getAudioRecorder();
        const recordButton = document.getElementById('recordButton');

        try {
            // 如果已有实例，先销毁
            if (this.sileroVad) {
                this.sileroVad.destroy();
                this.sileroVad = null;
            }

            // 清理旧的预缓冲资源
            this._cleanupPreBuffer();

            console.log('[Silero VAD] 开始初始化...');

            // ========== 步骤1: 初始化预缓冲 ==========
            // 先获取麦克风流用于预缓冲
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000,
                    channelCount: 1
                }
            });

            // 创建 AudioContext 用于预缓冲
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000,
                latencyHint: 'interactive'
            });

            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            // 创建音频源
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);

            // 创建 ScriptProcessorNode 用于采集 PCM 数据
            const bufferSize = 4096;
            this.audioProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
            source.connect(this.audioProcessor);

            // 初始化预缓冲区 (1秒 = 16000 样本)
            this.pcmBuffer = new Int16Array(16000);
            this.bufferWriteIndex = 0;
            this.bufferedSamples = 0;

            // 连接静音输出（避免回声）
            const silentGain = this.audioContext.createGain();
            silentGain.gain.value = 0;
            this.audioProcessor.connect(silentGain);
            silentGain.connect(this.audioContext.destination);

            // PCM 数据缓冲处理
            this.audioProcessor.onaudioprocess = (event) => {
                const inputData = event.inputBuffer.getChannelData(0);
                this._bufferPCMData(inputData);
            };

            console.log('[Silero VAD] 预缓冲初始化完成');

            // ========== 步骤2: 创建 Silero VAD 实例 ==========
            this.sileroVad = await vad.MicVAD.new({
                // 语音检测参数
                positiveSpeechThreshold: 0.7,   // 开始说话阈值
                negativeSpeechThreshold: 0.5,   // 停止说话阈值
                minSpeechFrames: 10,            // 最少10帧才触发开始 (~200ms)

                // 每帧处理回调
                onFrameProcessed: (probs) => {
                    const prob = probs?.isSpeech ?? 0;

                    // 更新置信度显示
                    this._updateVadConfidenceDisplay(prob);

                    // 手动强制停止检测：仅在"说话中"状态才检测
                    if (this.sileroIsSpeaking && prob < 0.5) {
                        this.sileroLowConfidenceFrames++;

                        if (this.sileroLowConfidenceFrames >= this.sileroForceStopThreshold) {
                            console.log('[Silero VAD] 触发强制停止');
                            this.forceStopSileroRecording();
                        }
                    } else {
                        // 置信度恢复，重置计数器
                        this.sileroLowConfidenceFrames = 0;
                    }
                },

                // 开始说话回调
                onSpeechStart: () => {
                    log('[Silero VAD] onSpeechStart 回调被触发', 'info');

                    if (!this.sileroIsSpeaking) {
                        this.sileroIsSpeaking = true;
                        this.sileroLowConfidenceFrames = 0;
                        log('[Silero VAD] 触发开始录音', 'success');

                        // ========== 发送预缓冲音频 ==========
                        const bufferedData = this._getBufferedAudio();
                        if (bufferedData && bufferedData.length > 0) {
                            log(`[Silero VAD] 发送预缓冲音频: ${bufferedData.length} 样本`, 'info');
                            audioRecorder.sendBufferedAudio(bufferedData);
                        }

                        // ========== 触发开始录音 ==========
                        log(`[Silero VAD] audioRecorder.isRecording: ${audioRecorder.isRecording}`, 'info');
                        if (!audioRecorder.isRecording) {
                            audioRecorder.start();
                        }
                    }
                },

                // 停止说话回调
                onSpeechEnd: (audio) => {
                    if (this.sileroIsSpeaking) {
                        this.sileroIsSpeaking = false;
                        const duration = (audio.length / 16000).toFixed(2);
                        console.log(`[Silero VAD] 触发停止录音 (${duration}s)`);

                        // ========== 触发停止录音 ==========
                        if (audioRecorder.isRecording) {
                            audioRecorder.stop();
                        }
                    }
                }
            });

            // 启动监听
            this.sileroVad.start();
            console.log('[Silero VAD] 初始化完成，开始监听');

            // 显示置信度显示区域
            const vadConfidenceDisplay = document.getElementById('vadConfidenceDisplay');
            if (vadConfidenceDisplay) {
                vadConfidenceDisplay.style.display = 'block';
            }

            // 更新按钮样式
            recordButton.style.opacity = '0.6';
            recordButton.style.cursor = 'default';

        } catch (error) {
            console.error('[Silero VAD] 初始化失败:', error);
            alert('Silero VAD 初始化失败: ' + error.message);
        }
    }

    // 将 Float32 PCM 数据存入环形缓冲区
    _bufferPCMData(float32Data) {
        if (!this.pcmBuffer) return;

        // 将 Float32 (-1.0 ~ 1.0) 转换为 Int16 (-32768 ~ 32767)
        for (let i = 0; i < float32Data.length; i++) {
            const sample = Math.max(-1, Math.min(1, float32Data[i]));
            const int16Sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;

            this.pcmBuffer[this.bufferWriteIndex] = int16Sample;
            this.bufferWriteIndex = (this.bufferWriteIndex + 1) % this.pcmBuffer.length;

            if (this.bufferedSamples < this.pcmBuffer.length) {
                this.bufferedSamples++;
            }
        }
    }

    // 获取预缓冲的 PCM 数据
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

        return result;
    }

    // 清理预缓冲资源
    _cleanupPreBuffer() {
        if (this.audioProcessor) {
            this.audioProcessor.disconnect();
            this.audioProcessor.onaudioprocess = null;
            this.audioProcessor = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        this.pcmBuffer = null;
        this.bufferWriteIndex = 0;
        this.bufferedSamples = 0;
    }

    // 强制停止 Silero VAD 录音（手动检测停止条件）
    forceStopSileroRecording() {
        const audioRecorder = getAudioRecorder();

        // 重置状态
        this.sileroIsSpeaking = false;
        this.sileroLowConfidenceFrames = 0;

        // ========== 触发停止录音 ==========
        if (audioRecorder.isRecording) {
            audioRecorder.stop();
        }

        // 暂停并重启监听
        if (this.sileroVad) {
            this.sileroVad.pause();
            setTimeout(() => {
                if (this.isAutoRecordEnabled && this.sileroVad) {
                    this.sileroVad.start();
                }
            }, 100);
        }
    }

    // 停止VAD检测
    stopVAD() {
        // 清理 Silero VAD
        if (this.sileroVad) {
            this.sileroVad.pause();
            this.sileroVad.destroy();
            this.sileroVad = null;
        }

        // 清理预缓冲资源
        this._cleanupPreBuffer();

        // 重置状态
        this.sileroIsSpeaking = false;
        this.sileroLowConfidenceFrames = 0;

        // 隐藏置信度显示区域
        const vadConfidenceDisplay = document.getElementById('vadConfidenceDisplay');
        if (vadConfidenceDisplay) {
            vadConfidenceDisplay.style.display = 'none';
        }

        const recordButton = document.getElementById('recordButton');
        recordButton.style.opacity = '1';
        recordButton.style.cursor = 'pointer';

        console.log('[Silero VAD] 已停止');
    }

    // 更新 VAD 置信度显示
    _updateVadConfidenceDisplay(prob) {
        const confidenceValue = document.getElementById('vadConfidenceValue');
        const statusFill = document.getElementById('vadStatusFill');
        const statusText = document.getElementById('vadStatusText');

        if (!confidenceValue || !statusFill || !statusText) return;

        // 更新数值
        confidenceValue.textContent = prob.toFixed(2);

        // 更新进度条 (0-100%)
        const percentage = Math.round(prob * 100);
        statusFill.style.width = percentage + '%';

        // 根据置信度设置颜色和状态文字
        if (prob >= 0.7) {
            statusFill.style.background = '#4CAF50'; // 绿色 - 说话中
            statusText.textContent = '说话';
            statusText.style.color = '#4CAF50';
        } else if (prob >= 0.5) {
            statusFill.style.background = '#FF9800'; // 橙色 - 可能说话
            statusText.textContent = '可能';
            statusText.style.color = '#FF9800';
        } else {
            statusFill.style.background = '#9E9E9E'; // 灰色 - 静音
            statusText.textContent = '静音';
            statusText.style.color = '#9E9E9E';
        }
    }
}

// 创建单例
let uiControllerInstance = null;

export function getUIController() {
    if (!uiControllerInstance) {
        uiControllerInstance = new UIController();
    }
    return uiControllerInstance;
}
