# pi-provider-service-tier

[English](README.md) | 中文

Pi 的 `service_tier` 扩展，按 provider/model 管理 API 服务档位。本仓库是 [luxmargos/pi-provider-service-tier](https://github.com/luxmargos/pi-provider-service-tier) 的维护 fork，额外保留按会话分支保存的 GPT Fast 模式。不改变提示词、工具、模型或推理档位。

## 版本与安装

本轮维护版本为 **0.1.7-fork.4**，基于社区 `0.1.7` 的 main 快照 `fccdf74d209d56c4ee3d9c1890e204a8b2703bff`。上一版 `0.1.7-fork.3` 及更早安装保留；回退前必须核对目标版本能读的状态格式。

```bash
pi install git:github.com/chenhaoxiang/pi-provider-service-tier@v0.1.7-fork.4
```

对应固定 tag / GitHub Release 发布后再安装；[Releases](https://github.com/chenhaoxiang/pi-provider-service-tier/releases) 包含安装包、精确来源清单和 `SHA256SUMS`。`main` 为维护整合线；`upstream-main` 仅镜像社区代码，不是安装来源。不向原作者 npm 身份发布。

需要 Node.js >=22.19.0 和兼容的 Pi。加 `-l` 为项目级安装；`pi list` 查看来源，`pi remove <来源>` 删除。不要同时安装并通过 `-e` 重复加载同一份扩展。新安装不会替换现有会话的内存代码，待任务结束后重启或 `/reload`。

## 会话 Fast

```text
/fast
/fast on
/fast off
/fast status
```

无参数切换；支持快捷键时可按 `Ctrl+Alt+F`。状态保存在当前会话分支，跟随 resume、`/tree`、`/fork`；新会话没有会话级覆盖，仍可继承已有持久配置。`/fast off` 删除当前目标 payload 的顶层 `service_tier`，但不改项目/用户设置。

只处理模型 ID 以 `gpt` 开头、API 为 `openai-responses`、`openai-completions` 或 `openai-codex-responses` 的模型，包括 `codex-local` 等自定义 provider。Kimi、DeepSeek、Claude、Gemini 和非 GPT 别名不受影响。

提供商明确拒绝该字段时，只把当前会话切回普通档位；支持 Pi boundary continuation 时，移除失败的 assistant 条目并申请一次继续。不切模型、不改推理设置。状态只表示发送了请求，不能证明服务端已提供优先调度；静默忽略字段不等于验证通过。

## 持久设置与档位选择

| 命令 | 行为 |
| --- | --- |
| `/service-tier-project [tier\|off\|status]` | 项目级档位；无参数打开选择器 |
| `/service-tier-user [tier\|off\|status]` | 用户默认档位；无参数打开选择器 |
| `/service-tier-fast-project [on\|off\|status]` | 项目级 GPT priority 快捷控制 |
| `/service-tier-fast-user [on\|off\|status]` | 用户级 GPT priority 快捷控制 |
| `/fast-project`、`/fast-user` | 上述持久控制的旧别名 |
| `/service-tier-status-format <format\|reset\|status>` | 设置或清除用户级底栏格式 |

可选值为 `priority`、`fast`、`ultrafast`、`flex`、`default`、`auto`、`scale`。`default` 和 `auto` 仍发送档位字段；停止注入请用 `off`。**付费档位可能增加费用，也不保证更快。**

持久功能仅允许 OpenAI、旧 Codex、OpenRouter、xAI、Groq 的受支持 API 路线；原生 Anthropic、Gemini/Vertex、Bedrock、未登记 provider 或不匹配 API 默认不操作。会话 Fast 是上面明确限定的独立 GPT 快捷路径，不放宽持久 provider 白名单。持久 priority 同样遵守 fork 的 GPT 限制。

选择器中，`✓` 表示之前探测验证，`?` 表示未知，`↪` 表示提供商回退到别的档位，`✕` 表示明确拒绝，`✎` 表示人工记录。**所有档位仍可选择，符号不代表未来保证。** 打开或取消选择器不会写配置、不会探测；实际选择沿用既有未知支持策略。

## 支持证据与探测

不再内置支持预设。相同 provider/model 通过不同 API、OAuth 或 API Key 使用时，档位支持也可能不同。记录按 provider/model/API/认证模式隔离；旧记录保留在未分类区域，不自动当作当前支持证据。更换同模式的账号或 Key 后仍需重新核验。

```text
/service-tier-unknown-behavior ask
/service-tier-unknown-behavior auto-probe
/service-tier-unknown-behavior leave-unknown
/service-tier-unknown-behavior status
/service-tier-unset-support
/service-tier-unset-support-all
```

默认 `ask` 在相关命令后询问是否探测或保持未知。**Auto Probe 会向实际模型发送多个低 token 请求，可能收费**；选择“始终探测”会允许后续相关操作再次探测。普通启动、打开选择器、清除支持记录本身不发探测。

只有请求 payload 确实准备了目标档位、SDK 请求完整结束、提供商返回的处理档位相符时，才记为验证通过。缺少处理档位元数据、请求失败或回退分别记录，不能把完成请求冒充已获得目标档位。关闭、切模型/认证模式或会话结束会取消后续请求，不保存过期结果；已处理请求仍可能计费。

`/service-tier-refresh-support` 和 `-all` 已移除。加载时会清退当前项目和用户设置、支持表中的旧 preset 元数据；只在实际移除后通知，并保留显式档位设置及人工/Probe 历史，不自动探测。配置损坏时暂停相关操作，不用低优先级设置掩盖错误。

## 配置与显示

- 项目：`.pi/extensions/pi-provider-service-tier.json`
- 用户：`~/.pi/agent/extensions/pi-provider-service-tier.json`
- 支持表：`~/.pi/agent/extensions/pi-provider-service-tier-map-v3.json`

项目字段覆盖同 provider/model 的用户字段。设置仍为 v2，新支持表按格式代际使用独立的 `-map-v3.json` 文件；首次只读导入旧 `-map.json`，此后旧会话写旧文件不影响新版记录，不做双向同步。旧手工和探测历史保留，不把它们猜成当前认证证据。回退前用 `scripts/check-support-map-rollback.mjs` 核对目标文件格式；若旧路径已是 v3，不能直接交给旧 v2 包。保留新旧文件，不覆盖升级后记录；优先在安全空闲点统一新版。

```json
{
  "version": 2,
  "unknownModelBehavior": "ask",
  "entries": {
    "openai/gpt-6.1-sol": { "active": true, "serviceTier": "priority" }
  }
}
```

底栏可以显示 off、请求的档位及支持证据，不重复 provider/model。可用 `{label}`、`{symbol}`、`{tier}`、`{support}` 自定义 `statusFormat`；这只影响显示，不更改启用状态或探测许可。

`/service-tier-debug on|off|status` 控制当前会话调试。非底栏通知带扩展名，避免和其他扩展混淆。持久档位失败会记录当前 API/认证模式的拒绝证据，**不重试失败请求**；与会话 Fast 的一次普通档位继续不同。

## 开发与验证

```bash
npm ci --ignore-scripts
npm run check
```

完整检查包含 TypeScript、provider-free 单测及打包 dry-run。本轮验证不调用真实模型、不探测账户。隔离加载可用 `pi -e .`，不要同时加载已安装副本。

`npm run bench:service-tier`、`:quick`、`:stress`、`:stress:light`、`:swap` 会真实调用 provider，只有明确授权才运行。默认 `openai/gpt-6.1-sol`，支持 `PST_BENCH_MODEL` 覆盖；轻量 stress 为四次 completion，并非免费测试。详见 [配置](docs/configuration.md)、[支持与探测](docs/support-and-probes.md)、[基准](docs/benchmarking.md)及[发布流程](docs/releasing.md)。

## 许可证

MIT，保留社区作者署名。
