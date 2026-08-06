# OpenDesign 集成

将 9Router 与 [OpenDesign](https://github.com/Diwak4r/OpenDesign)（一款 AI 原生的设计 agent IDE）集成,通过 9Router 的智能路由系统转发每一次视觉与代码生成请求。

## 为什么选择 OpenDesign + 9Router

OpenDesign 把 prompt 当作设计规格处理——具备图像感知输入、布局意图、调色板约束以及结构化输出。与 9Router 搭配可以带来:

- **迭代安全**——在订阅 / 兜底档位上持续设计,不消耗付费席位
- **多模型扇出**——同一个 brief 上同时比较 vision 模型与代码模型
- **自动回退**——若 provider 在迭代中途限流,9Router 静默切换到下一个已配置的 provider
- **统一用量遥测**——在一个仪表盘里看到所有 render、generate、edit 请求

## 前置要求

- 已安装 OpenDesign(CLI 或桌面版)
- 9Router 本地运行 **或** 配置好 9Router 云端 endpoint
- 来自 9Router 仪表盘的 API key

> **注意**:OpenDesign 同时支持 `localhost` 与云端 endpoint,任选其一即可。

## 设置

### 1. 打开 OpenDesign 设置

1. 启动 OpenDesign
2. 进入 **Settings → Providers**
3. 点击 **Add Custom Provider**

### 2. 配置 Base URL

将 base URL 设置为你的 9Router endpoint:

**本地 9Router:**
```
http://localhost:20128/v1
```

**云端 9Router:**
```
https://9router.com/v1
```

**步骤:**
1. 在 **Base URL** 字段中粘贴你的 9Router endpoint
2. 确保路径以 `/v1` 结尾

### 3. 添加 API Key

1. 在 **API Key** 字段中输入 9Router API key
2. 在 9Router 仪表盘 **Settings → API Keys** 中获取
3. Key 以 `sk-9router-` 开头

### 4. 选择默认模型

OpenDesign 允许为 chat 设置默认模型,并为 generation 设置另一个。推荐搭配:

| 任务 | 模型前缀 | 示例 |
|---|---|---|
| 视觉推理(默认) | `cc/` | `cc/claude-sonnet-4-20250514` |
| 快速迭代 | `glm/` | `glm/glm-4-flash` |
| 代码密集的布局 | `cx/` | `cx/deepseek-chat` |

OpenDesign 会通过 `/v1/models` endpoint 自动发现 9Router 实例上的全部模型。

### 5. 开启 Image-Aware 模式

进入 **Settings → Generation**,启用 **Image-aware prompts**。该选项会把附带的图像包装成 OpenAI payload 中标准的 `image_url` 段——9Router 会原样透传给底层 provider。

### 6. 保存并验证

点击 **Test Connection**。OpenDesign 会向 9Router 发送 `GET /v1/models`。绿色对勾表示路由已生效。

## 配置示例

OpenDesign 中的 provider 条目应为:

```
Name:        9Router
Base URL:    http://localhost:20128/v1
API Key:     sk-9router-xxxxxxxxxxxxx
Chat Model:  cc/claude-sonnet-4-20250514
Gen Model:   glm/glm-4-plus
Streaming:   on
Image-aware: on
```

## 可用模型

你可以使用 9Router 仪表盘暴露的任何模型。最适合设计工作流的几个:

| 模型名称 | 提供商 | 适用场景 |
|---|---|---|
| `cc/claude-sonnet-4-20250514` | Anthropic | 视觉推理、布局点评 |
| `cc/claude-opus-4-5-20251101` | Anthropic | 高保真规格撰写 |
| `cx/deepseek-chat` | DeepSeek | 代码生成、组件脚手架 |
| `glm/glm-4-plus` | 智谱 AI | 快速迭代、调色板工作 |
| `gemini/gemini-2.0-flash` | Google | 多模态附件、快速预览 |

在 **Project → Model** 中按项目切换模型。

## 使用方式

### 带设计上下文的对话

1. 打开一个设计文件(`.opendsg`、Figma JSON、图像或草图)
2. 打开对话面板(`Cmd/Ctrl + Shift + L`)
3. 引用具体图层:*"把 hero padding 收紧到 32px,把 CTA 对比度提到 AA"*
4. OpenDesign 会把当前 canvas 作为 `image_url` 上下文;9Router 转发给 chat 模型

### 生成组件

1. 按 `Cmd/Ctrl + G` 打开 generate 对话框
2. 描述组件:*"一张三档定价卡,粘性 CTA,深色模式"*
3. OpenDesign 通过 9Router 请求代码模型,结果直接内联渲染

### 在 Mock 上迭代

1. 把截图或线框拖入 canvas
2. 询问:*"生成它的高保真 Tailwind 版本,保留间距"*
3. OpenDesign 经由 9Router 流式回传 token;你可随时打断并调整方向

### 调色板与设计 Token

1. 在 canvas 上选中一个颜色
2. 询问:*"基于这个基色建一个 12 步感知均匀的 token scale"*
3. 生成的 token 会落地为命名变量,可在整个项目中复用

## 故障排查

### "Connection Failed"

1. 验证 9Router 正在运行:`curl http://localhost:20128/health`
2. 确认 base URL 以 `/v1` 结尾
3. 检查防火墙未阻止 20128 端口
4. 在 OpenDesign 中再次点击 **Test Connection**

### "Invalid API Key"

1. 从 9Router 仪表盘重新拷贝 key
2. 确认 `sk-9router-` 前缀完整
3. 检查 key 未在 **Settings → API Keys** 中被吊销

### "Model Not Found"

1. 运行 `curl http://localhost:20128/v1/models` 核对准确的模型 id
2. 确认底层 provider 在 9Router 仪表盘中已连接(绿色状态)
3. 尝试使用完整限定名:`cc/claude-sonnet-4-20250514` 而非 `claude-sonnet-4`

### 图像附件未被识别

1. 确认 OpenDesign 设置中 **Image-aware prompts** 已开启
2. 验证当前模型支持 vision(查阅 provider 文档)
3. 检查 9Router 日志——图像段应出现在 `messages[].content[].type == "image_url"`

### 首 token 慢

1. OpenDesign 在渲染前会等待首个字节,prompt 越大越慢
2. 对 chat 启用 **Streaming** + 较快模型,把重型模型留给 generation
3. 在 9Router 仪表盘预热 combo,使回退路径保持已连接

## 最佳实践

1. **模型与任务匹配**——视觉点评用 vision-capable 模型,脚手架用 code 模型,调色板工作用快速模型
2. **通过 combo 组合**——在 9Router 中构建把同一 brief 扇给两个模型并挑选更便宜的有效响应的 combo
3. **观察 quota**——设计迭代很费 token,工作时常驻仪表盘
4. **按项目复用**——在项目级别固化 model + base URL,使不同项目能绑定不同档位
5. **轮换 API key**——每 60 天生成一次新的 `sk-9router-` key

## 与 9Router 功能的集成

### 智能路由

9Router 选择既满足模型可用性又满足健康约束的最便宜 provider——非常适合紧迭代循环。

### Combos

串联两到三个 provider,让 Claude 视觉评审可以回退到 GLM,再到 Gemini Flash,整个过程 OpenDesign 完全无感。

### 配额跟踪

每一次 render、generate、edit 都会进入仪表盘的 **Usage**。按 `provider=opendesign` 过滤即可隔离设计工作。

### Token 节省器

把 OpenDesign 接入 9Router 上游的 [RTK](https://github.com/rtk-ai/rtk) 或 [Headroom](https://github.com/chopratejas/headroom),在送入模型前压缩长 canvas 描述。

## 下一步

- [浏览其他集成](other-tools.md)
- [设置智能路由](../features/smart-routing.md)
- [配置 combos 与回退](../features/combos.md)
- [跨 provider 跟踪配额](../features/quota-tracking.md)