# 反代快速管理台

一个面向 **CliProxyApi** 的可视化管理台，用来替代命令行处理 `codex` 认证文件、额度状态、停用恢复和请求事件明细。

## 功能概览

- 文件池管理：上传、启用、停用、删除、批量处理
- 额度池管理：查看会话额度、代码额度、重置时间、异常状态
- 停用池与异常处置：区分 401、额度异常、其他异常
- 请求事件明细：查看成功 / 失败、来源、认证索引和 Token 消耗

## 效果图预览
<img width="1849" height="891" alt="图片" src="https://github.com/user-attachments/assets/98dd8327-bc6d-4659-8b88-02456ea2593c" />
<img width="1845" height="880" alt="图片" src="https://github.com/user-attachments/assets/ceb21ccd-c607-416f-8db7-1b9f309228ea" />
<img width="1839" height="877" alt="图片" src="https://github.com/user-attachments/assets/691ccaaa-2269-4daf-9e98-7bc0acefeb3b" />
<img width="1825" height="885" alt="图片" src="https://github.com/user-attachments/assets/8e986e97-1bdf-42bf-a4ab-bbf56dd834aa" />
<img width="1853" height="903" alt="图片" src="https://github.com/user-attachments/assets/5ad19225-baca-4318-9cb4-28837299e7b5" />
<img width="1844" height="887" alt="图片" src="https://github.com/user-attachments/assets/1197e02c-3299-4e1f-9fac-c2570c252f78" />


## 运行环境

开始前请先准备：

- `Node.js 18+`
- `npm 9+`
- 一个可访问的 `CliProxyApi` 管理地址
- 对应的 `Management Key`

## 获取项目

```bash
git clone <your-repo-url>
cd 解压后的路径
npm install
```

## 配置方式

项目使用：

```text
config/app-config.json
```

作为默认配置文件。

### 你需要做的事

1. 打开：

```text
config/app-config.json
```

2. 修改 `management` 配置中的这两个字段：

```json
{
  "management": {
    "baseUrl": "http://127.0.0.1:8317",
    "key": "your-management-key"
  }
}
```

### 常用可选项

你也可以按需调整这些参数：

- `management.interval`
- `management.showFilename`
- `management.autoRefresh`
- `management.autoRefreshMode` (`files` / `files-and-quotas`)
- `management.lowQuotaThreshold`
- `management.quotaConcurrency`
- `management.quotaRequestIntervalSeconds`
- `server.host`
- `server.port`

## 启动项目

### 开发模式

```bash
npm run dev
```

默认访问：

```text
http://127.0.0.1:5173
```

### 生产模式

```bash
npm start
```

默认访问：

```text
http://127.0.0.1:8090
```

兼容入口：

```text
http://127.0.0.1:8090/management.html
```

## 可用脚本

```bash
npm run dev     # 启动 Vite 开发环境
npm run build   # 构建前端
npm run serve   # 启动本地 Express 服务
npm start       # 构建并启动本地服务
```

## 使用说明

启动后，按下面顺序使用即可：

1. 在系统设置确认管理地址和 `Management Key`
2. 进入文件管理，拉取认证文件列表
3. 在额度池查看额度状态和重置时间
4. 在异常处置里处理 401、额度异常和其他异常
5. 在使用情况里查看请求事件明细和 Token 消耗

## 注意事项

- 当前主链路只针对 `codex` 认证文件
- `runtime_only=true` 的条目不会允许删除或启停
- 如服务端未开启 usage 统计，请求事件明细不会返回可用数据
- 时间范围筛选目前基于已拉取事件的时间戳做前端过滤

## 安全建议

如果你准备把项目推到公开仓库，请不要提交真实的：

- 管理地址
- `Management Key`
- SSH / 邮箱 / 代理等私有配置

仓库里的 `config/app-config.json` 应该只保留安全示例值。

## 目录结构

```text
.
├─ client/      # Vue 前端
├─ server/      # Express 本地服务
├─ config/      # 默认配置
├─ docs/        # 设计文档
├─ LICENSE      # Apache-2.0 开源协议
└─ README.md
```

## License

This project is licensed under the Apache License 2.0.
