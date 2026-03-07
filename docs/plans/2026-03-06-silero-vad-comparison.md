# Silero VAD 对比测试页面 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 创建一个对比测试页面，并排展示现有频率分析 VAD 和 Silero VAD 的检测效果，帮助决策是否采用新方案。

**Architecture:**
- 单页面应用，使用原生 JavaScript + ES Modules
- 现有 VAD 复用 `VADDetector` 类
- Silero VAD 使用 `@ricky0123/vad-web` (CDN 引入)
- 双 VAD 同时监听同一麦克风，实时对比检测结果

**Tech Stack:**
- 原生 HTML/CSS/JavaScript (ES Modules)
- @ricky0123/vad-web 0.0.29 (Silero VAD)
- ONNX Runtime Web 1.22.0

---

## Task 1: 创建 HTML 页面结构

**Files:**
- Create: `test_webrtcvad_voice.html`

**Step 1: 创建 HTML 基础结构**

创建 `test_webrtcvad_voice.html`：

```html
<!DOCTYPE html>
<html lang="zh-CN">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VAD 对比测试 - 频率分析 vs Silero</title>
    <link rel="stylesheet" href="css/test_webrtcvad_voice.css">
    <script>
        // 检测是否使用file://协议打开
        if (window.location.protocol === 'file:') {
            document.addEventListener('DOMContentLoaded', function () {
                const warningDiv = document.createElement('div');
                warningDiv.id = 'fileProtocolWarning';
                warningDiv.innerHTML = `
                    <h2>⚠️ 警告：请使用HTTP服务器打开此页面</h2>
                    <p>请按照以下步骤启动HTTP服务器：</p>
                    <ol>
                        <li>打开命令行终端，进入 test 目录</li>
                        <li>执行：<pre>python -m http.server 8006</pre></li>
                    </ol>
                    <p>然后访问：<strong>http://localhost:8006/test_webrtcvad_voice.html</strong></p>
                `;
                document.body.appendChild(warningDiv);
            });
        }
    </script>
    <!-- ONNX Runtime Web -->
    <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.wasm.min.js"></script>
    <!-- Silero VAD -->
    <script src="https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/bundle.min.js"></script>
</head>

<body>
    <div class="container">
        <h1>🔊 VAD 对比测试页面</h1>
        <p class="subtitle">对比「频率分析 VAD」与「Silero VAD」的检测效果</p>

        <!-- 双 VAD 对比区域 -->
        <div class="vad-comparison">
            <!-- 左侧：现有频率分析 VAD -->
            <div class="vad-panel" id="legacyVadPanel">
                <h2>📊 频率分析 VAD (现有)</h2>
                <p class="vad-desc">基于音量阈值检测</p>

                <div class="volume-display">
                    <div class="volume-bar-container">
                        <div class="volume-bar">
                            <div class="volume-fill" id="legacyVolumeFill"></div>
                            <div class="volume-threshold" id="legacyThreshold"></div>
                        </div>
                        <div class="volume-value" id="legacyVolumeValue">0</div>
                    </div>
                </div>

                <div class="status-item">
                    <span class="status-label">状态:</span>
                    <span class="status-value" id="legacyStatus">🔇 等待开始</span>
                </div>

                <div class="config-item">
                    <label>音量阈值:</label>
                    <input type="range" id="legacyThresholdSlider" min="0" max="100" value="12">
                    <span id="legacyThresholdValue">12</span>
                </div>
            </div>

            <!-- 右侧：Silero VAD -->
            <div class="vad-panel" id="sileroVadPanel">
                <h2>🤖 Silero VAD (深度学习)</h2>
                <p class="vad-desc">基于神经网络模型</p>

                <div class="volume-display">
                    <div class="volume-bar-container">
                        <div class="volume-bar">
                            <div class="volume-fill silero" id="sileroConfidenceFill"></div>
                            <div class="volume-threshold silero" id="sileroThreshold"></div>
                        </div>
                        <div class="volume-value" id="sileroConfidenceValue">0.00</div>
                    </div>
                </div>

                <div class="status-item">
                    <span class="status-label">状态:</span>
                    <span class="status-value" id="sileroStatus">🔇 等待开始</span>
                </div>

                <div class="config-item">
                    <label>语音阈值:</label>
                    <input type="range" id="sileroThresholdSlider" min="0" max="100" value="50">
                    <span id="sileroThresholdValue">0.50</span>
                </div>

                <div class="status-item loading" id="sileroLoading">
                    <span>⏳ 加载模型中...</span>
                </div>
            </div>
        </div>

        <!-- 触发记录对比 -->
        <div class="section">
            <h2>📝 触发记录对比</h2>
            <div class="record-header">
                <span class="col-time">时间</span>
                <span class="col-legacy">频率分析 VAD</span>
                <span class="col-silero">Silero VAD</span>
            </div>
            <div class="record-container" id="recordContainer">
                <div class="record-entry">等待开始测试...</div>
            </div>
            <button class="clear-btn" id="clearRecordBtn">清空记录</button>
        </div>

        <!-- 控制按钮 -->
        <div class="control-buttons">
            <button class="control-btn start-btn" id="startBtn">🎤 开始测试</button>
            <button class="control-btn stop-btn" id="stopBtn" disabled>⏹️ 停止测试</button>
        </div>
    </div>

    <script type="module" src="js/test_webrtcvad_voice.js"></script>
</body>

</html>
```

**Step 2: 验证文件创建成功**

运行: `ls test_webrtcvad_voice.html`
预期: 文件存在

---

## Task 2: 创建 CSS 样式文件

**Files:**
- Create: `css/test_webrtcvad_voice.css`

**Step 1: 创建样式文件**

创建 `css/test_webrtcvad_voice.css`：

```css
/* 基础样式 */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    min-height: 100vh;
    color: #fff;
    padding: 20px;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
}

h1 {
    text-align: center;
    font-size: 2rem;
    margin-bottom: 10px;
}

.subtitle {
    text-align: center;
    color: #888;
    margin-bottom: 30px;
}

/* file:// 协议警告 */
#fileProtocolWarning {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #fff;
    color: #333;
    padding: 30px;
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    z-index: 1000;
    max-width: 500px;
}

#fileProtocolWarning pre {
    background: #f5f5f5;
    padding: 10px;
    border-radius: 5px;
    margin: 10px 0;
}

/* VAD 对比区域 */
.vad-comparison {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin-bottom: 30px;
}

.vad-panel {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 15px;
    padding: 20px;
    backdrop-filter: blur(10px);
}

.vad-panel h2 {
    font-size: 1.2rem;
    margin-bottom: 5px;
}

.vad-desc {
    color: #888;
    font-size: 0.9rem;
    margin-bottom: 20px;
}

/* 音量/置信度显示 */
.volume-display {
    margin-bottom: 20px;
}

.volume-bar-container {
    display: flex;
    align-items: center;
    gap: 15px;
}

.volume-bar {
    flex: 1;
    height: 30px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 15px;
    position: relative;
    overflow: hidden;
}

.volume-fill {
    height: 100%;
    width: 0%;
    background: linear-gradient(90deg, #4CAF50, #8BC34A);
    border-radius: 15px;
    transition: width 0.05s ease;
}

.volume-fill.silero {
    background: linear-gradient(90deg, #2196F3, #03A9F4);
}

.volume-fill.speaking {
    background: linear-gradient(90deg, #FF5722, #FF9800);
}

.volume-threshold {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: #f44336;
    left: 12%;
}

.volume-threshold.silero {
    left: 50%;
}

.volume-value {
    font-size: 1.5rem;
    font-weight: bold;
    min-width: 60px;
    text-align: right;
}

/* 状态项 */
.status-item {
    display: flex;
    justify-content: space-between;
    padding: 10px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.status-label {
    color: #888;
}

.status-value {
    font-weight: bold;
}

.status-value.speaking {
    color: #4CAF50;
}

.status-value.silence {
    color: #888;
}

/* 配置项 */
.config-item {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 15px;
}

.config-item label {
    color: #888;
    min-width: 80px;
}

.config-item input[type="range"] {
    flex: 1;
    accent-color: #4CAF50;
}

.config-item span {
    min-width: 40px;
    text-align: right;
}

/* 加载状态 */
.loading {
    text-align: center;
    padding: 20px;
    color: #FFC107;
}

.loading.hidden {
    display: none;
}

/* 触发记录区域 */
.section {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 15px;
    padding: 20px;
    margin-bottom: 20px;
    backdrop-filter: blur(10px);
}

.section h2 {
    margin-bottom: 15px;
}

.record-header {
    display: grid;
    grid-template-columns: 100px 1fr 1fr;
    gap: 10px;
    padding: 10px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    margin-bottom: 10px;
    font-weight: bold;
    color: #888;
}

.record-container {
    max-height: 200px;
    overflow-y: auto;
}

.record-entry {
    display: grid;
    grid-template-columns: 100px 1fr 1fr;
    gap: 10px;
    padding: 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.record-entry .col-time {
    color: #888;
}

.record-entry .start {
    color: #4CAF50;
}

.record-entry .stop {
    color: #f44336;
}

.clear-btn {
    margin-top: 10px;
    padding: 8px 16px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    border-radius: 5px;
    color: #888;
    cursor: pointer;
    transition: all 0.2s;
}

.clear-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
}

/* 控制按钮 */
.control-buttons {
    display: flex;
    justify-content: center;
    gap: 20px;
}

.control-btn {
    padding: 15px 40px;
    font-size: 1.1rem;
    border: none;
    border-radius: 30px;
    cursor: pointer;
    transition: all 0.3s;
    font-weight: bold;
}

.start-btn {
    background: linear-gradient(135deg, #4CAF50, #8BC34A);
    color: #fff;
}

.start-btn:hover:not(:disabled) {
    transform: scale(1.05);
    box-shadow: 0 4px 20px rgba(76, 175, 80, 0.4);
}

.stop-btn {
    background: linear-gradient(135deg, #f44336, #FF5722);
    color: #fff;
}

.stop-btn:hover:not(:disabled) {
    transform: scale(1.05);
    box-shadow: 0 4px 20px rgba(244, 67, 54, 0.4);
}

.control-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
}

/* 响应式 */
@media (max-width: 768px) {
    .vad-comparison {
        grid-template-columns: 1fr;
    }

    .record-header,
    .record-entry {
        grid-template-columns: 80px 1fr 1fr;
        font-size: 0.9rem;
    }
}
```

**Step 2: 验证文件创建成功**

运行: `ls css/test_webrtcvad_voice.css`
预期: 文件存在

---

## Task 3: 创建 JavaScript 逻辑文件

**Files:**
- Create: `js/test_webrtcvad_voice.js`

**Step 1: 创建 JavaScript 文件**

创建 `js/test_webrtcvad_voice.js`：

```javascript
// VAD 对比测试页面逻辑
import { log } from './utils/logger.js';
import { getVADDetector } from './core/audio/vad.js';

class VadComparisonController {
    constructor() {
        // 现有 VAD
        this.legacyVad = null;

        // Silero VAD
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
            // 使用全局 vad 对象（CDN 加载）
            if (typeof vad === 'undefined' || !vad.MicVAD) {
                throw new Error('Silero VAD 库未加载');
            }

            this.elements.sileroLoading.classList.add('hidden');
            this.addRecord('system', 'Silero VAD 模型加载完成');
        } catch (error) {
            this.elements.sileroLoading.innerHTML = `<span style="color: #f44336;">❌ 加载失败: ${error.message}</span>`;
            console.error('Silero VAD 初始化失败:', error);
        }
    }

    async startListening() {
        this.addRecord('system', '开始监听...');
        this.elements.startBtn.disabled = true;

        try {
            // 启动现有 VAD
            const legacySuccess = await this.legacyVad.start();
            if (!legacySuccess) {
                throw new Error('现有 VAD 启动失败');
            }

            // 启动 Silero VAD
            if (typeof vad !== 'undefined' && vad.MicVAD) {
                this.sileroVad = await vad.MicVAD.new({
                    positiveSpeechThreshold: this.sileroThreshold,
                    negativeSpeechThreshold: this.sileroThreshold * 0.7,
                    minSpeechFrames: 3,
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
                    },
                    onVADMisfire: () => {
                        // 误触发回调
                    }
                });

                // 启动 Silero 监听
                await this.sileroVad.start();
            }

            this.isListening = true;
            this.elements.startBtn.disabled = true;
            this.elements.stopBtn.disabled = false;
            this.addRecord('system', '✅ 双 VAD 监听已启动');

        } catch (error) {
            this.addRecord('system', `❌ 启动失败: ${error.message}`);
            this.elements.startBtn.disabled = false;
        }
    }

    stopListening() {
        // 停止现有 VAD
        if (this.legacyVad) {
            this.legacyVad.stop();
        }

        // 停止 Silero VAD
        if (this.sileroVad) {
            this.sileroVad.pause();
            this.sileroVad.destroy();
            this.sileroVad = null;
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
        this.elements.legacyVolumeValue.textContent = volume;

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
            this.elements.sileroConfidenceFill.classList.add('speaking');
        } else {
            this.elements.sileroStatus.textContent = '🔇 静音中';
            this.elements.sileroStatus.className = 'status-value silence';
            this.elements.sileroConfidenceFill.classList.remove('speaking');
        }
    }

    addRecord(source, action) {
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

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    window.vadComparisonController = new VadComparisonController();
});
```

**Step 2: 验证文件创建成功**

运行: `ls js/test_webrtcvad_voice.js`
预期: 文件存在

---

## Task 4: 本地测试验证

**Step 1: 启动本地服务器**

运行: `cd /c/claude-project/xiaozhi-webui/xiaozhi-test/test && python -m http.server 8006`

**Step 2: 打开浏览器测试**

访问: `http://localhost:8006/test_webrtcvad_voice.html`

验证项：
- [ ] 页面正常加载，无 JS 错误
- [ ] Silero VAD 模型加载成功
- [ ] 点击"开始测试"后，两个 VAD 都能检测音量
- [ ] 说话时，触发记录显示两者的检测结果
- [ ] 调整阈值滑块，阈值线位置正确更新

**Step 3: 修复发现的问题**

如有问题，修复后重新测试。

---

## Task 5: Git 提交

**Step 1: 提交代码**

```bash
git add test_webrtcvad_voice.html css/test_webrtcvad_voice.css js/test_webrtcvad_voice.js
git commit -m "feat: 添加 Silero VAD 对比测试页面

- 新增 test_webrtcvad_voice.html: 双 VAD 对比测试页面
- 新增 css/test_webrtcvad_voice.css: 页面样式
- 新增 js/test_webrtcvad_voice.js: 对比测试逻辑
- 使用 @ricky0123/vad-web (Silero VAD) 与现有频率分析 VAD 对比
- 支持实时音量/置信度显示、触发记录对比

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

**Step 2: 推送到远程**

```bash
git push
```

---

## 执行选项

**1. Subagent-Driven (当前会话)** - 我逐个任务执行，每个任务完成后检查

**2. Parallel Session (新会话)** - 打开新会话，使用 executing-plans 批量执行

选择哪种方式？
