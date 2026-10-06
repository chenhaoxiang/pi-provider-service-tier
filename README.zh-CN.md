# pi-provider-service-tier

[English](README.md) | 中文

Pi 的 `service_tier` 扩展，按 provider/model 管理 API 服务档位。本仓库是 [luxmargos/pi-provider-service-tier](https://github.com/luxmargos/pi-provider-service-tier) 的维护 fork，额外保留按会话和分支保存的 GPT Fast 模式。它不改提示词、工具、模型或推理档位。

## 功能

- 向提供商请求的对象 payload 注入顶层 `service_tier`；
- 配置按当前 provider/model 隔离，支持项目配置和用户默认；
- 提供持久的 `/service-tier-fast-*`、显式服务档位命令、支持状态表及底部状态；
- `/fast` 只改变当前会话分支，不修改项目/用户配置；
- 会话 Fast 支持 GPT 模型的 `openai-responses`、`openai-completions` 和 `openai-codex-responses`；
- 服务端明确不支持档位时，记录错误；会话 Fast 可在支持边界 API 的 Pi 中回退到普通档位并申请一次继续。

持久配置只有在当前 provider/model 已启用、配置了档位、请求 payload 是对象时才注入。支持表不会自行阻断明确启用的请求。该扩展通过 payload hook 注入字段，不调整 Pi 内部 `serviceTier` 的计费乘数；状态表示请求了 Fast，不证明服务端调度器已接受。

## 要求

Pi、Node.js >=22；GitHub 安装还需要 Git。提供商必须支持相应档位。收费或优先档位可能增加费用，请按账户合同使用。

## 发布版本与分支约定

当前维护版本为 **0.1.7-fork.1**，基于社区 **0.1.7**。fork 版本统一使用 `<社区版本>-fork.<修订号>`，本地修订不冒充社区新版本。

- `main`：我们的维护、整合与发布主线，保留 fork 修复。
- `upstream-main`：仅镜像社区 `main`，不加入 fork 提交，也不作为安装来源。
- 改动通过经过审核的 PR 合入 `main`；保留现有分支和历史。

固定版本安装：

```bash
pi install git:github.com/chenhaoxiang/pi-provider-service-tier@v0.1.7-fork.1
```

[GitHub Releases](https://github.com/chenhaoxiang/pi-provider-service-tier/releases) 提供可安装的包、来源清单和 `SHA256SUMS` 校验文件；这不是向上游作者的 npm 命名空间发布。发布及制品安装流程见[维护说明](docs/releasing.md)。

## 安装与快速开始

```bash
pi install git:github.com/chenhaoxiang/pi-provider-service-tier@v0.1.7-fork.1
```

加 `-l` 为项目级安装；只有需要跟踪维护主线时才使用 `@main`。上游 npm 包是独立发布线，不保证包含本 fork 的会话 Fast 修复。重启或 `/reload` 后使用 `/fast on`，或持久的 `/service-tier-fast-project on`。

本地开发：

```bash
git clone https://github.com/chenhaoxiang/pi-provider-service-tier.git
cd pi-provider-service-tier
npm ci --ignore-scripts
pi -e .
```

可用 `pi install -l .` 安装本地目录；不要同时用 `-e .` 重复加载已安装副本。`pi list` 查看来源；卸载用 `pi remove git:github.com/chenhaoxiang/pi-provider-service-tier@v0.1.7-fork.1`，项目级加 `-l`；本地目录用 `pi remove -l .`。

## 会话 Fast 模式

```text
/fast
/fast on
/fast off
/fast status
```

分别用于切换、启用、停用及查看当前会话状态。支持快捷键时可按 `Ctrl+Alt+F`。状态保存为自定义会话条目，跟随 resume、`/tree`、`/fork`；`/new` 默认关闭。

只处理模型 ID 以 `gpt` 开头且属于上述三种 API 的模型；Kimi、DeepSeek、Claude、Gemini、非 GPT 别名均不改变。`codex-local` 等自定义 provider 也支持，不要求 provider ID 为 `openai`。提供商拒绝字段时，仅当前会话回退普通档位；支持 Pi boundary continuation 时，去掉失败的 assistant 条目后申请一次继续。不切模型、不改推理设置。服务端静默忽略字段时，仍视为普通成功请求，不能声称获得优先调度。

## 持久项目/用户控制

| 命令 | 范围 | 用法 |
| --- | --- | --- |
| `/service-tier-fast-project` | 当前项目 | 无参数切换；`on`、`off`、`status` |
| `/service-tier-fast-user` | 用户默认 | 无参数切换；`on`、`off`、`status` |
| `/service-tier-project <tier>` | 当前项目 | `priority`、`flex`、`default`、`auto`、`scale`、`off`、`status` |
| `/service-tier-user <tier>` | 用户默认 | 同上 |

旧 `/fast-project` 和 `/fast-user` 别名保留。命令只作用于当前 provider/model；输入命令加空格后按 Tab 获取参数补全。

## 状态与支持表

底部显示 `service_tier ○ off`、`service_tier: ⚡ priority` 或 `service_tier: ● <tier>`；未知支持状态追加 `unknown`。不重复显示 Pi 已有的 provider/model。支持的有效档位用绿色，设置 `NO_COLOR` 时不着色。

```text
/service-tier-refresh-support
/service-tier-refresh-support-all
/service-tier-unset-support
/service-tier-unset-support-all
```

刷新仅从内置 preset 更新当前或所有已注册模型，不调用提供商；unset 删除对应支持记录，让状态变为未知，不代表“不支持”。已有 `source: probe` 条目包含所选档位时，档位与 fast 命令保留探测结果；需要用 preset 覆盖时显式刷新。

## 未知支持状态与收费探测

```text
/service-tier-unknown-behavior ask
/service-tier-unknown-behavior auto-probe
/service-tier-unknown-behavior leave-unknown
/service-tier-unknown-behavior status
```

默认 `ask`：明确执行档位、fast 或刷新命令且支持未知时，选择“探测一次”“始终探测”“本次保持未知”或“始终保持未知”。仅 `determined: false` 且非 `source: user-mark` 时显示询问。命令修改用户配置，项目配置可覆盖。

**auto-probe 会向当前真实模型发低 token 请求，遍历已知服务档位，可能收费。** 探测在后台进行并显示进度；期间正常请求不排队，沿当前配置运行。只有全部档位判定完整才原子写入 `source: probe` 的 `tiers`/`unsupportedTiers`；存在未确定项时不写入部分结果，失败不自动重试。刷新 preset 本身不探测。

## 调试

```text
/service-tier-debug on
/service-tier-debug off
/service-tier-debug status
```

调试仅当前会话有效，显示每次请求是否注入字段及跳过原因。

## 配置文件

项目：`.pi/extensions/pi-provider-service-tier.json`；用户：`~/.pi/agent/extensions/pi-provider-service-tier.json`；支持表：`~/.pi/agent/extensions/pi-provider-service-tier-map.json`。用户配置提供默认，同一 provider/model 的项目字段覆盖用户字段，未覆盖的用户条目继续生效。旧 `pi-service-tier*.json` 需自行迁入当前名称。

配置示例：

```json
{
  "version": 2,
  "unknownModelBehavior": "ask",
  "entries": {
    "openai/gpt-5.5": { "active": true, "serviceTier": "priority" },
    "openai/gpt-4.1": { "active": false, "serviceTier": "flex" }
  }
}
```

`unknownModelBehavior` 可省略，默认 `ask`，支持上述三种策略。启动时逐版本迁移已有配置及支持表，然后从 preset 刷新非探测记录；读取兼容旧文件，迁移写回发生在启动期间。

支持表示例：

```json
{
  "version": 2,
  "entries": {
    "openai/gpt-5.5": {
      "provider": "openai", "id": "gpt-5.5", "api": "openai-responses",
      "determined": true, "tiers": ["priority", "flex", "default", "auto", "scale"],
      "source": "preset", "updatedAt": "2026-05-19T00:00:00.000Z"
    }
  }
}
```

`determined` 表示 preset 或完整探测已确定支持。`source` 为 `preset`、`probe`、正常请求观察到错误的 `error`、用户保持未知的 `user-mark`，或人工改表的 `manual`。

| Provider/API | 模型 | Preset 档位 |
| --- | --- | --- |
| `openai` + Responses/Completions | 所有 | priority、flex、default、auto、scale |
| `openai-codex` + Codex Responses | 已探测 preset 中的模型 | priority、default |
| 同上 | 其他模型 | priority |
| `opencode-go` + Completions | preset 中已探测模型 | 按型号，通常五种档位 |

其他 provider/model 保持未知，除非刷新 preset 或完整探测写入结果。

## 不支持档位的错误

持久模式观察到 unsupported/invalid `service_tier` 时：从当前 provider/model 的支持档位中移除该档位，写入 `unsupportedTiers`，通知用户，**不重试失败请求**。后续仍沿明确启用的项目/用户配置注入；不希望再发送时需关闭或换档位。这与上面的会话 Fast 一次性普通档位 continuation 不是同一路径。

## 开发与验证

```bash
npm ci --ignore-scripts
npm run check
```

`check` 包含 TypeScript、Node 单测和打包 dry-run。本轮发布验证不调用真实模型或自动探测。

手动临时加载可用 `pi -e . --provider openai --model gpt-5.5`。以下基准测试会实际调用账户并可能收费，不属于 provider-free 验证：

```bash
npm run bench:service-tier
npm run bench:service-tier:quick
npm run bench:service-tier:stress
npm run bench:service-tier:swap
```

默认模型为 `openai-codex/gpt-5.5`。基准只加载本目录，按成对 off/priority 请求交替顺序比较首输出和总时延，记录差值、胜出次数与实用阈值；baseline 用项目 `active:false` 覆盖用户优先设置。默认一对预热加三对实测；quick 为无预热一对。可设置 `PST_BENCH_MODEL`、`PST_BENCH_START_WITH=tier`、`PST_BENCH_ROUNDS`、`PST_BENCH_WARMUPS`、`PST_BENCH_THINKING`、`PST_BENCH_PROMPT_FILE`、`PST_BENCH_MIN_CHARS=0`、`PST_BENCH_PROGRESS_MS=0`、`PST_BENCH_PRACTICAL_DELTA_MS`、`PST_BENCH_PRACTICAL_DELTA_PCT`、`PST_BENCH_TIER` 调整流程。基准会读取本地用户档位配置，只应在明确授权后运行。

## 许可证

MIT
