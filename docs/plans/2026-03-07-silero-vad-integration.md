# Silero VAD 集成计划

> 将 Silero VAD 集成到 test_page，替换原有的音量阈值 VAD

## 1. 现有流程 (Existing Flow)

### 当前 VAD 架构

```
test_page.html
    └── js/app.js
        └── js/ui/controller.js
            └── js/core/audio/vad.js (传统音量阈值 VAD)
```

### 当前触发流程

```
用户开启"自动录音"开关
    ↓
UIController.startVAD()
    ↓
创建 VADDetector (音量阈值检测)
    ↓
├─ 音量 > 阈值 && 持续 > 200ms → onStartRecording → audioRecorder.start()
└─ 音量 < 阈值 && 持续 > 1200ms → onStopRecording → audioRecorder.stop()
```

### 回调接口 (保持不变)

```javascript
// UIController 中设置的回调
this.vad.onStartRecording = () => audioRecorder.start();
this.vad.onBufferedAudio = (pcmData) => audioRecorder.sendBufferedAudio(pcmData);
this.vad.onStopRecording = () => audioRecorder.stop();
```

## 2. 扩展点 (Extension Point)

### 允许修改的文件

| 文件 | 修改内容 |
|------|---------|
| `test_page.html` | 添加 Silero VAD 的 CDN 引用 |
| `js/ui/controller.js` | 修改 `startVAD()` 方法，使用 Silero VAD |

### 不修改的文件

| 文件 | 原因 |
|------|------|
| `js/core/audio/vad.js` | 保留原有实现，不破坏现有功能 |
| `js/core/audio/recorder.js` | 录音器逻辑不变 |
| 其他所有文件 | 保持原有行为 |

## 3. 非破坏规则 (Non-breaking Rules)

### 必须保持不变

1. **回调接口不变**：`onStartRecording`, `onStopRecording`, `onBufferedAudio` 回调签名保持一致
2. **录音器调用不变**：`audioRecorder.start()`, `audioRecorder.stop()` 调用方式不变
3. **UI 状态不变**：`updateRecordButtonState()` 等UI更新逻辑不变
4. **开关逻辑不变**：自动录音开关的启用/禁用逻辑不变
5. **旧 VAD 文件保留**：`js/core/audio/vad.js` 不删除不修改

### 可以改变

1. **VAD 检测实现**：从音量阈值改为 Silero 深度学习模型
2. **触发参数**：从 `volumeThreshold/startDelay/stopDelay` 改为 `positiveSpeechThreshold/negativeSpeechThreshold`

## 4. 风险点 (Risk Points)

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Silero VAD 加载失败 | 功能不可用 | 添加错误处理，提示用户 |
| 模型加载延迟 | 首次启动慢 | 显示加载状态 |
| 强制停止不触发 onSpeechEnd | 停止录音漏触发 | 在 forceStop 中手动调用 onStopRecording |
| 预缓冲机制丢失 | 录音开头丢失 | **用户确认：不需要预缓冲，录音器自己处理** |

## 5. 实现任务

### Task 1: 添加 Silero VAD CDN 引用
- 文件: `test_page.html`
- 内容: 添加 ONNX Runtime 和 VAD bundle 的 CDN 引用
- 验证: 页面加载无报错，`window.vad` 存在

### Task 2: 修改 UIController 的 startVAD 方法
- 文件: `js/ui/controller.js`
- 内容: 将 `VADDetector` 替换为 Silero VAD
- 验证: 自动录音开关开启后，说话能触发开始录音

### Task 3: 处理强制停止逻辑
- 文件: `js/ui/controller.js`
- 内容: 在低置信度强制停止时也触发 onStopRecording
- 验证: 说话结束后能正常触发停止录音

## 6. 集成代码设计

```javascript
// js/ui/controller.js 中的 startVAD 方法

async startVAD() {
    // 检查 Silero VAD 是否可用
    if (!window.vad) {
        console.error('Silero VAD 未加载');
        return;
    }

    try {
        // 创建 Silero VAD 实例
        this.sileroVad = await window.vad.MicVAD.new({
            positiveSpeechThreshold: 0.7,
            negativeSpeechThreshold: 0.5,
            minSpeechFrames: 10,

            onSpeechStart: () => {
                // ========== 触发开始录音 ==========
                if (this.onStartRecording) {
                    this.onStartRecording();
                }
            },

            onSpeechEnd: (audio) => {
                // ========== 触发停止录音 ==========
                if (this.onStopRecording) {
                    this.onStopRecording();
                }
            },

            onFrameProcessed: (probs) => {
                // 手动强制停止检测
                const prob = probs?.isSpeech ?? 0;
                if (this.sileroIsSpeaking && prob < 0.5) {
                    this.sileroLowConfidenceFrames++;
                    if (this.sileroLowConfidenceFrames >= 10) {
                        this.forceStopSileroRecording();
                    }
                } else {
                    this.sileroLowConfidenceFrames = 0;
                }
            }
        });

        // 启动监听
        this.sileroVad.start();

    } catch (error) {
        console.error('Silero VAD 初始化失败:', error);
    }
}

// 强制停止方法
forceStopSileroRecording() {
    // ========== 触发停止录音 ==========
    if (this.onStopRecording) {
        this.onStopRecording();
    }

    // 重置并重启监听
    this.sileroVad.pause();
    setTimeout(() => {
        if (this.sileroVad) {
            this.sileroVad.start();
        }
    }, 100);
}
```

## 7. 验证清单

- [ ] 页面加载成功，无 JS 报错
- [ ] 开启自动录音开关后，Silero VAD 正常启动
- [ ] 说话时触发"开始录音"
- [ ] 停止说话时触发"停止录音"（两种方式都能触发）
- [ ] 录音器正常工作，音频正常发送
- [ ] 关闭自动录音开关后，Silero VAD 正常停止
- [ ] 手动点击录音按钮仍然正常工作
