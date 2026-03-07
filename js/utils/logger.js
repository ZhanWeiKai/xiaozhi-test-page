import { getLogContainer } from '../ui/dom-helper.js'

// 日志记录函数
export function log(message, type = 'info') {
    // 将消息按换行符分割成多行
    const lines = message.split('\n');
    const now = new Date();
    const timestamp = `[${now.toLocaleTimeString()}.${now.getMilliseconds().toString().padStart(3, '0')}] `;

    // 始终输出到控制台
    const consoleMsg = `${timestamp}${message}`;
    if (type === 'error') {
        console.error(consoleMsg);
    } else if (type === 'warning') {
        console.warn(consoleMsg);
    } else {
        console.log(consoleMsg);
    }

    // 尝试获取日志容器，如果不存在则跳过DOM操作
    const logContainer = getLogContainer();
    if (!logContainer) {
        return;
    }

    // 为每一行创建日志条目
    lines.forEach((line, index) => {
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${type}`;
        // 如果是第一条日志，显示时间戳
        const prefix = index === 0 ? timestamp : ' '.repeat(timestamp.length);
        logEntry.textContent = `${prefix}${line}`;
        // logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        // logEntry.style 保留起始的空格
        logEntry.style.whiteSpace = 'pre';
        if (type === 'error') {
            logEntry.style.color = 'red';
        } else if (type === 'debug') {
            logEntry.style.color = 'gray';
            return;
        } else if (type === 'warning') {
            logEntry.style.color = 'orange';
        } else if (type === 'success') {
            logEntry.style.color = 'green';
        } else {
            logEntry.style.color = 'black';
        }
        logContainer.appendChild(logEntry);
    });

    logContainer.scrollTop = logContainer.scrollHeight;
}