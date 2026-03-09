# xiaozhi-webtest 部署文档

## 概述

部署 test_page 到服务器，通过 Cloudflare Tunnel 提供 HTTPS 访问。

**目标 URL**: `https://xiaozhi-webtest.jamesweb.org`

---

## 系统架构

### WebUI 架构（参考）

WebUI 使用 **WebSocket 代理** 模式解决 HTTPS → WS 混合内容问题：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            WebUI 架构                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  前端 (HTTPS)                                                            │
│  https://xiaozhi.jamesweb.org                                           │
│       │                                                                  │
│       │ wss://xiaozhi-ws.jamesweb.org (安全 WebSocket)                  │
│       ▼                                                                  │
│  Cloudflare Tunnel                                                       │
│       │                                                                  │
│       │ 路由到 ws://127.0.0.1:5000                                      │
│       ▼                                                                  │
│  WebSocket Proxy (Python 后端)                                          │
│  监听 0.0.0.0:5000                                                       │
│  配置: ws://127.0.0.1:8000/xiaozhi/v1                                   │
│       │                                                                  │
│       │ 本地连接（不需要 wss）                                           │
│       ▼                                                                  │
│  xiaozhi-server (Docker)                                                │
│  端口 8000                                                               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**关键点**：
- 前端使用 `wss://` (安全 WebSocket)
- WebSocket Proxy 在服务器本地连接 xiaozhi-server
- Proxy 有自己的认证逻辑（TOKEN、DEVICE_ID）

---

### WebTest 架构（新部署）

WebTest 使用 **直连模式**，通过独立的 Tunnel 路由：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          WebTest 架构                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  前端 (HTTPS)                                                            │
│  https://xiaozhi-webtest.jamesweb.org                                   │
│       │                                                                  │
│       │ 1. 请求 OTA: https://xiaozhi.jamesweb.org/api/ota/              │
│       ▼                                                                  │
│  Cloudflare Tunnel → nginx:8100 → WebUI Backend                        │
│       │                                                                  │
│       │ OTA 返回: ws://10.88.1.141:8000/xiaozhi/v1                      │
│       │ (数据库 server.fronted_url 配置)                                │
│       ▼                                                                  │
│  前端代码替换 URL:                                                       │
│  ws://10.88.1.141:8000 → wss://xiaozhi-wstest.jamesweb.org             │
│       │                                                                  │
│       │ 2. WebSocket 连接: wss://xiaozhi-wstest.jamesweb.org/xiaozhi/v1│
│       ▼                                                                  │
│  Cloudflare Tunnel                                                       │
│       │                                                                  │
│       │ 路由到 ws://127.0.0.1:8000                                      │
│       ▼                                                                  │
│  xiaozhi-server (Docker)                                                │
│  端口 8000                                                               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**关键点**：
- OTA 使用 WebUI Backend 的 API (`/api/ota/`)
- 前端代码自动替换 WebSocket URL（解决混合内容问题）
- 独立的 Tunnel 路由直接连接 xiaozhi-server

---

## 服务器信息

- **IP**: 10.88.1.144 (hostname: spark-3601)
- **用户**: axonex
- **sudo 密码**: Aimo123456

### 端口分配

| 端口 | 服务 | 类型 |
|------|------|------|
| 5000 | WebUI WS 代理 | Python |
| 5001 | WebUI.me WS 代理 | Python |
| 8000 | xiaozhi-server WebSocket | Docker |
| 8002 | manager-web | Docker |
| 8003 | xiaozhi-server HTTP | Docker |
| **8009** | **xiaozhi-webtest** | **nginx** |
| 8081 | WebUI Backend | Python |
| 8100 | WebUI 前端 | nginx |
| 8101 | WebUI.me 前端 | nginx |
| 10095 | FunASR GPU | Docker |

---

## Cloudflare Tunnel 配置

- **Tunnel ID**: `6b50289d-9aed-4f66-8e57-16e8be9a8b76`
- **配置文件**: `/etc/cloudflared/config.yml`

### 域名映射

| 域名 | 服务 | 端口 |
|------|------|------|
| `xiaozhi.jamesweb.org` | WebUI 前端 + API | 8100 |
| `xiaozhi-ws.jamesweb.org` | WebUI WebSocket 代理 | 5000 (ws) |
| `xiaozhi-webtest.jamesweb.org` | 测试页面 | 8009 |
| `xiaozhi-wstest.jamesweb.org` | 测试页面 WebSocket | 8000 (ws) |
| `test.jamesweb.org` | 旧测试页面（待废弃） | 8006 |

### 完整配置

```yaml
tunnel: 6b50289d-9aed-4f66-8e57-16e8be9a8b76
credentials-file: /etc/cloudflared/6b50289d-9aed-4f66-8e57-16e8be9a8b76.json

ingress:
  # 主要服务
  - hostname: xiaozhi-ws.jamesweb.org
    service: ws://127.0.0.1:5000
  - hostname: xiaozhi.jamesweb.org
    service: http://127.0.0.1:8100

  # 测试页面
  - hostname: xiaozhi-webtest.jamesweb.org
    service: http://127.0.0.1:8009
  - hostname: xiaozhi-wstest.jamesweb.org
    service: ws://127.0.0.1:8000

  # 旧配置（待清理）
  - hostname: test.jamesweb.org
    service: http://127.0.0.1:8006
  - hostname: xiaozhi-test-ota.jamesweb.org
    service: http://127.0.0.1:8002

  - service: http_status:404
```

---

## DNS Records

在 Cloudflare Dashboard 配置：

| 类型 | 名称 | 目标 | 代理状态 |
|------|------|------|----------|
| CNAME | xiaozhi | `6b50289d-...cfargotunnel.com` | 已代理 |
| CNAME | xiaozhi-ws | `6b50289d-...cfargotunnel.com` | 已代理 |
| CNAME | xiaozhi-webtest | `6b50289d-...cfargotunnel.com` | 已代理 |
| CNAME | xiaozhi-wstest | `6b50289d-...cfargotunnel.com` | 已代理 |

> **注意**: 所有域名使用相同的 Tunnel，所以 CNAME 目标相同。

---

## 代码修改

### 1. `js/config/manager.js` - OTA URL 自动替换

```javascript
const savedOtaUrl = localStorage.getItem('xz_tester_otaUrl');
if (savedOtaUrl) {
    // 检测旧地址（内网地址或过期的临时隧道）
    if (savedOtaUrl.includes('10.88.1.') || savedOtaUrl.includes('trycloudflare.com')) {
        const newOtaUrl = 'https://xiaozhi.jamesweb.org/api/ota/';
        console.log('[OTA URL] 检测到旧地址，已自动替换为正式域名:', newOtaUrl);
        otaUrlInput.value = newOtaUrl;
        localStorage.setItem('xz_tester_otaUrl', newOtaUrl);
    } else {
        otaUrlInput.value = savedOtaUrl;
    }
}
```

### 2. `js/core/network/ota-connector.js` - WebSocket URL 替换

```javascript
// 使用OTA返回的websocket URL
// OTA 服务器会根据 server.fronted_url 配置返回地址
// 但数据库配置的是内网地址(ws://10.88.1.141:8000)，需要替换为外网安全地址
let wsUrl = websocket.url;
log(`[DEBUG] OTA返回的WebSocket URL: ${wsUrl}`, 'info');

// 替换内网地址为外网安全 WebSocket 地址
if (wsUrl.includes('10.88.1.141:8000') || wsUrl.includes('10.88.1.144:8000')) {
    wsUrl = wsUrl.replace(/ws:\/\/10\.88\.1\.\d+:8000/, 'wss://xiaozhi-wstest.jamesweb.org');
    log(`[DEBUG] 已替换为外网安全地址: ${wsUrl}`, 'info');
}
```

### 3. `test_page.html` - 默认 OTA URL

```html
<input type="text" id="otaUrl" value="https://xiaozhi.jamesweb.org/api/ota/" />
```

---

## Nginx 配置

**文件**: `/etc/nginx/sites-available/xiaozhi-webtest.conf`

```nginx
server {
    listen 8009;
    server_name _;

    root /var/www/xiaozhi-webtest-2026-3-9;
    index test_page.html;

    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|wasm|mjs|onnx)$ {
        expires 1d;
        add_header Cache-Control "public, immutable";
    }

    # SPA 路由支持
    location / {
        try_files $uri $uri/ /test_page.html =404;
    }
}
```

---

## 部署步骤

### Step 1: 修改本地代码

- [x] `js/config/manager.js` - OTA URL 自动替换
- [x] `js/core/network/ota-connector.js` - WebSocket URL 替换
- [x] `test_page.html` - 默认 OTA URL

### Step 2: 部署到服务器

```bash
# 创建临时目录
mkdir -p /tmp/xiaozhi-webtest

# 复制文件（排除 .git 和日志）
scp -r css js assets test_page.html test_voice.html test_voice.css axonex@10.88.1.144:/tmp/xiaozhi-webtest/

# 移动到 nginx 目录
ssh axonex@10.88.1.144 "sudo cp -r /tmp/xiaozhi-webtest/* /var/www/xiaozhi-webtest-2026-3-9/ && sudo chown -R www-data:www-data /var/www/xiaozhi-webtest-2026-3-9/"
```

### Step 3: 配置 Nginx

```bash
ssh axonex@10.88.1.144 "sudo ln -sf /etc/nginx/sites-available/xiaozhi-webtest.conf /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx"
```

### Step 4: 更新 Cloudflare Tunnel

```bash
ssh axonex@10.88.1.144 "sudo cp ~/.cloudflared/config.yml /etc/cloudflared/config.yml && sudo systemctl restart cloudflared"
```

### Step 5: 添加 DNS Record

在 Cloudflare Dashboard 添加 `xiaozhi-webtest` 和 `xiaozhi-wstest` 的 CNAME 记录。

### Step 6: 验证部署

```bash
# 测试页面访问
curl -sI https://xiaozhi-webtest.jamesweb.org/test_page.html

# WebSocket Tunnel 测试
curl -sI https://xiaozhi-wstest.jamesweb.org/xiaozhi/v1
```

---

## 访问地址

| 服务 | URL |
|------|-----|
| **测试页面** | https://xiaozhi-webtest.jamesweb.org/test_page.html |
| **WebSocket** | wss://xiaozhi-wstest.jamesweb.org/xiaozhi/v1 |
| **OTA API** | https://xiaozhi.jamesweb.org/api/ota/ |
| **WebUI** | https://xiaozhi.jamesweb.org |

---

## 故障排查

### 问题: WebSocket 连接失败 "Mixed Content"

**原因**: HTTPS 页面无法连接 `ws://` 地址

**解决**: 确保代码中的 URL 替换逻辑正确执行，检查控制台日志

### 问题: OTA 返回错误的 WebSocket URL

**原因**: 数据库 `server.fronted_url` 配置不正确

**检查**:
```bash
docker exec xiaozhi-esp32-server-db mysql -uroot -p123456 xiaozhi_esp32_server \
  -e "SELECT param_value FROM sys_params WHERE param_code='server.fronted_url';"
```

**当前值**: `http://10.88.1.141` (内网地址)

### 问题: Cloudflare Tunnel 不工作

**检查**:
```bash
# 检查 cloudflared 状态
sudo systemctl status cloudflared

# 检查配置文件
cat /etc/cloudflared/config.yml

# 查看日志
sudo journalctl -u cloudflared -n 50
```

---

## 回滚计划

```bash
# 1. 删除 nginx 配置
ssh axonex@10.88.1.144 "sudo rm -f /etc/nginx/sites-enabled/xiaozhi-webtest.conf && sudo nginx -s reload"

# 2. 恢复 cloudflared 配置
ssh axonex@10.88.1.144 "sudo systemctl restart cloudflared"

# 3. 删除 DNS Record（在 Cloudflare Dashboard）
```

---

## 清理计划

部署稳定后，可以清理旧资源：

```bash
# 删除旧的 nginx 配置
ssh axonex@10.88.1.144 "sudo rm -f /etc/nginx/sites-enabled/xiaozhi-test-pages.conf && sudo nginx -s reload"
```

从 Cloudflare 移除：
- `test.jamesweb.org`
- `xiaozhi-test-ota.jamesweb.org`

---

**创建时间**: 2026-03-09
**更新时间**: 2026-03-09
**状态**: ✅ 已完成
