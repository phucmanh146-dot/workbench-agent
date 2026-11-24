# 项目工作台（Workbench）

> 学生项目规划与执行 Agent · 全国人工智能应用创新大赛参赛作品
>
> 从目标到复盘的全周期管理：用 AI 把散落的规则、资料、任务、日程与工时串成一条可核对的执行链。

## 作品定位

面向课程、竞赛、考研、副业与学校作业的本地 AI 工作台。它把"定目标—拆任务—排日程—执行—复盘"做成闭环，解决学生"多任务不会拆、拆了落不到日历、AI 说生成了却没生效"的真实痛点。

## 核心功能

1. **五步 AI 拆解**：资料与规则 → 赛道与目标 → 作品差距 → 拆解子任务 → 确认月调度，把大目标拆成可执行任务树。
2. **资料转待办**：从通知、公告、讲义中识别待办，核对标题、截止与执行日期后写入，来源可回溯。
3. **冲突感知排期**：月总览与项目排期定日期、今日时间表落到钟点；固定时段优先保留，冲突时整批停止并提示重生成。
4. **任务中心三视图**：清单、看板、四象限查看同一套任务。
5. **番茄钟与实际工时**：绑定任务计时，确认后写入时间日志，按日统计实耗。
6. **突发事务与当日缓冲**：记录断点与下一步，处理完按建议恢复；当日缓冲窗口默认 17:00–18:00。
7. **五问复盘与项目记忆**：按"做了什么/产出什么/花了多久/该减什么/怎么改进"复盘并存回知识库。
8. **课表图片识别**：从课表截图识别课程、星期、起止时刻与单双周，排程自动避开固定时段。
9. **AI 助理与知识库**：项目对话、规则问答、资料归档、链接保存与 AI 写作草稿。

**设计主线：三种结果状态契约。** AI 产出严格区分为"分析/预览""已保存草稿""已应用"，草稿必须到项目排期确认应用才进入正式任务与月总览。Skill 负责理解、分析与核对规则，工作台负责真实保存；未连接工作台时只输出可复制草稿，不虚报写入。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19 + TypeScript 5.9 + Vite 7 |
| 后端 | Java 21 + Spring Boot 3.5 + Spring JDBC |
| 存储 | SQLite（本地单文件，Hikari 单连接，开启外键约束） |
| 文档解析 | Apache PDFBox 3 |
| Agent | `workbench-planning` Skill（可导入支持 Skill 的 AI 工具） |

## 目录结构

```
.
├── frontend/               # React 前端源码（src/main.tsx 为主界面）
│   └── src/
├── backend/                # Java Spring Boot 后端源码与 Maven 配置
│   └── src/main/
│       ├── java/local/workbench/
│       └── resources/      # application.properties、schema.sql
├── workbench-planning/     # Agent Skill：流程契约、验证用例与参考文档
│   ├── SKILL.md
│   ├── QUICKSTART.md
│   └── references/
├── install.ps1 / build.ps1 # 环境准备与构建
├── setup-ai.ps1            # 模型接口配置
├── proxy.ps1               # 企业网络代理助手
├── start.ps1 / run.bat     # 启动入口
└── *.bat                   # Windows 双击入口
```

## 快速开始（Windows 64 位）

1. 首次运行 `setup.bat`，联网下载所需工具并构建程序，等待完成。
2. 运行 `setup-ai.bat`，填写自己的模型接口、模型名称与 API Key。
3. 运行 `run.bat`，在浏览器打开工作台（默认 <http://127.0.0.1:8080>），保留运行窗口。
4. 修改模型设置后，关闭旧运行窗口再重新运行 `run.bat`。

首次使用为空白数据。数据、配置与构建输出在使用时于本目录内生成，均被 `.gitignore` 忽略。

## 配置说明

模型配置通过 `setup-ai.ps1` 交互式写入环境变量或本地配置，支持 OpenAI、DeepSeek、阿里云百炼等 OpenAI 兼容接口。可选配置：

| 变量 | 用途 |
| --- | --- |
| `WORKBENCH_AI_BASE_URL` / `WORKBENCH_AI_MODEL` / `WORKBENCH_AI_KEY` | 主模型接口、名称与密钥 |
| `WORKBENCH_AI_SEARCH_MODEL` / `WORKBENCH_AI_VISION_MODEL` | 搜索与视觉模型（图片识别需视觉模型） |
| `WORKBENCH_FEISHU_APP_ID` / `WORKBENCH_FEISHU_APP_SECRET` | 飞书文档读取（可选） |

密钥只保存在本机，不随源码提交。程序占用本机 8080 端口，启动前请关闭其他占用该端口的程序。

## Agent Skill

`workbench-planning/` 是可独立导入的 Agent Skill，包含五步拆解流程、三种结果状态契约、七类验收用例与参考文档。它与工作台职责分离：Skill 负责理解与规划，工作台负责真实保存；即使没有连接工作台，也能输出可复制的草稿。

- 入口：`workbench-planning/SKILL.md`
- 快速上手：`workbench-planning/QUICKSTART.md`

## 参赛信息

- 赛道：AI Agent 应用 / AI 产品与效率工具
- 申报人：韩奕（山东财经大学）

## 许可

本项目用于全国人工智能应用创新大赛作品展示与学习交流。源码版权归作者所有，未经许可不得用于商业用途。
