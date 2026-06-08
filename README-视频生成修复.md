# 视频生成功能修复说明

## 问题原因

之前视频生成失败的原因是：**未配置 PUBLIC_BASE_URL**

视频生成 API（n1n.ai）需要访问你上传的图片，但本地地址 `http://127.0.0.1:5173` 无法从外网访问，导致系统自动进入 mock 演示模式。

## 解决方案

已配置 **Localtunnel 内网穿透**，将本地服务暴露到公网，让 API 能够访问图片。

## 使用方法

### 方式 1：一键启动（推荐）

直接双击运行：
```
启动服务.cmd
```

这个脚本会自动：
1. 启动 localtunnel 内网穿透
2. 获取公网 URL 并更新 .env 配置
3. 启动服务器
4. 打开浏览器

### 方式 2：手动启动

1. **启动内网穿透**（在一个终端窗口）：
   ```bash
   npx localtunnel --port 5173
   ```
   
2. **复制显示的 URL**（例如：`https://abc-123.loca.lt`）

3. **更新 .env 文件**：
   ```
   PUBLIC_BASE_URL=https://abc-123.loca.lt
   ```

4. **启动服务器**（在另一个终端窗口）：
   ```bash
   node server.mjs
   ```

## 验证是否成功

启动服务器后，查看日志应该显示：

```
Motion Video: omni-flash via https://llm-api.net/v1/video/create（PUBLIC_BASE_URL=https://xxx.loca.lt）
```

✅ **不再显示** "mock mode（未配置 PUBLIC_BASE_URL）"

## 注意事项

1. **保持内网穿透运行**：视频生成期间，localtunnel 必须保持运行状态
2. **URL 会变化**：每次重启 localtunnel，URL 会变化，需要重新更新 .env
3. **首次访问**：访问 localtunnel URL 时，可能需要点击确认按钮
4. **代理设置**：确保 .env 中的代理配置正确（如果需要）

## 当前配置

- **视频模型**：`omni-flash`（主模型）
- **备用模型**：`viduq3`, `viduq3-turbo`
- **视频时长**：10 秒
- **分辨率**：4K
- **点数消耗**：60 灵感值/次
- **API 端点**：https://llm-api.net/v1/video/create

## 故障排查

### 问题：视频仍然生成失败

1. 检查 PUBLIC_BASE_URL 是否正确配置
2. 确认 localtunnel 正在运行
3. 检查代理设置（HTTP_PROXY、HTTPS_PROXY）
4. 查看服务器日志：`tail -f server.log`

### 问题：localtunnel 连接不稳定

可以考虑使用其他内网穿透工具：
- **ngrok**（更稳定，需注册）：https://ngrok.com
- **frp**（自建服务器）
- **Cloudflare Tunnel**（免费，稳定）

### 问题：API 密钥错误

检查 .env 中的配置：
- `OPENAI_API_KEY`：用于图片和文案生成
- `XIAOJI_API_KEY`：用于视频生成（如果使用 xiaoji 端点）

## 相关文件

- `.env` - 环境配置文件
- `启动服务.cmd` - 一键启动脚本
- `server.mjs` - 服务器主文件
- `tunnel.log` - 内网穿透日志
- `server.log` - 服务器日志

## 联系支持

如遇到问题，请查看：
- 服务器日志：`server.log`
- 内网穿透日志：`tunnel.log`
- 或联系技术支持（配置中的微信号）
