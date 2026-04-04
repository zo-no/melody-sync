# 腾讯云 Nginx/反向代理接入 MelodySync（适用于 443 HTTPS 外网暴露）

本文档给出将 MelodySync 通过腾讯云主机（Nginx）反向代理对外暴露的最小可运行方案。

## 适用前提

- 腾讯云主机上已运行并可访问 `melody-sync` 的 `chat-server`（默认 `127.0.0.1:7760` / `0.0.0.0:7760`）。
- 域名已解析到该主机（或 CLB 后端监听转发到该主机）。
- 站点对外使用 HTTPS（推荐），并已准备证书。

## 关键前提（反代成功率）

- MelodySync 当前资源与 API 都是按站点根路径（`/`）设计，`/login`、`/api/...`、`/chat/...`、`/ws` 等都会默认使用根路径。
- 若你要挂到二级目录（如 `https://domain/app`），建议改为单独子域名到同一端口，不要用二级目录，或者先做前端/网关重写补丁。

- **服务监听地址**：若 Nginx 与服务在同一主机，`CHAT_BIND_HOST` 可保持 `127.0.0.1`；若服务可能跨容器/跨网卡，改为 `0.0.0.0`。
- **Cookie 安全性**：
  - HTTPS 对外访问：`SECURE_COOKIES=1`（默认）。
  - 纯本地 HTTP：仅测试用途才可设为 `0`。
- **端口**：保持 `CHAT_PORT=7760`，或与你的 service 文件一致。

## 推荐启动参数

```bash
export CHAT_BIND_HOST=127.0.0.1
export CHAT_PORT=7760
export SECURE_COOKIES=1
melodysync chat
```

如果希望服务只绑定在回环口但让 Nginx 通过同机代理访问，上述是最小权限选项。

若你希望服务监听全部网卡，再改为：

```bash
export CHAT_BIND_HOST=0.0.0.0
export CHAT_PORT=7760
export SECURE_COOKIES=1
melodysync chat
```

## Nginx 配置示例（完整）

```nginx
map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      close;
}

server {
  listen 443 ssl http2;
  server_name your-domain.com;

  # 你的证书路径（按实配置）
  ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

  client_max_body_size 20m;

  location / {
    proxy_pass         http://127.0.0.1:7760;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_set_header   Upgrade           $http_upgrade;
    proxy_set_header   Connection        $connection_upgrade;
    proxy_set_header   Accept-Encoding    "";
  }
}

server {
  listen 80;
  server_name your-domain.com;
  return 301 https://$host$request_uri;
}
```

> 说明：
> - `Upgrade/Connection` 这两行是 WebSocket 必要项（`/ws`）。
> - 上面 `proxy_set_header Connection $connection_upgrade;` 配合 `map` 比较稳。

## 腾讯云 CLB 方案（可选）

- 在 CLB 上建立 443 HTTPS 监听，转发到主机上你自己的 Nginx。
- 若你把 CLB 直接转发到 `7760`，请确认：
  - 允许 WebSocket 头（尤其 `Upgrade`、`Connection`）。
  - 后端健康检查建议指向 `GET /`（或你自己的可访问页）且返回可用状态。
  - 有 HTTPS 终止时，服务端仍可保持 `SECURE_COOKIES=1`。

## 验证清单

1. 本地可访问服务：
   - `curl -I http://127.0.0.1:7760/`（或实际监听地址）
   - `curl -I https://your-domain.com/`（返回 MelodySync 页面/重定向）
2. WS 验证：
   - 浏览器打开页面后，功能面应能实时收到列表变更；控制台不应持续报 `ws` 握手失败。
3. 登录稳定性：
   - 在外网链接首次进入时能正常完成 token 登录（或密码入口）。
4. 日志跟踪：
   - `journalctl --user -u melodysync-chat -f`
   - Nginx `access.log` / `error.log`

## 常见问题（先排这三类）

1. `502 Bad Gateway`
   - `melody-sync` 是否在 `7760` 监听？（`lsof -i :7760` / `ss -ltnp | grep 7760`）
   - `CHAT_BIND_HOST` 是否与 Nginx 转发链路匹配。
2. 登录页反复跳转/状态异常
   - 检查浏览器控制台请求是否全在 `https://your-domain.com` 域。
   - 检查 `SECURE_COOKIES`，HTTPS 下应为 `1`。
3. WS 无法连接
   - 检查 Nginx 是否转发了 `Upgrade`/`Connection` 头。
   - 检查防火墙是否拦截 443 或后端 7760。
