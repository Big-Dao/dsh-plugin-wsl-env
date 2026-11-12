# Product Marketing Context — dsh-plugin-wsl-env

> 供推广类技能(marketing-* / gtm-*)自动读取的上下文文件。完整规划:`~/Projects/plans/dsh-wsl-env-promotion.md`。
> 基线快照:2026-11-13。

## 产品一句话

把 WSL 发行版变成 DeepSeek Harness(DSH)桌面会话真正的执行环境:命令、shell 脚本、文件访问、终端、目录选择器都在发行版内完成,DSH 权限模型保留,受限命令经 bubblewrap 沙箱;不在发行版装服务、不开端口。

## 阶段与基线

- v0.25.0;仓库约 6 周;npm 月下载 3,891;GitHub 7 stars;外部 issue 1 个(#37,真实用户)
- 上游:deepseek-ai/deepseek-harness,279,623 stars,公开,Discussions 开启,**无官方插件索引**(生态位机会)
- 推广目标(1–2 月,全部):下载量/装机量、早期用户与反馈、项目认知度、上游生态位
- 投入:5+ 小时/周;受众:中英均衡双语;内容上限:含视频(本地 hyperframes 工具链可用)
- 每周 5 小时按 barbell 分配:80% 稳仓(上游触点/搜索面/存量答问),20% 实验仓(Show HN/视频/doctor 独立入口)

## 受众与 JTBD

- 主受众:在 Windows 上使用 DSH 桌面应用、项目位于 WSL 2 发行版的开发者与 agent 重度用户。
- Job story:「当我的 agent 在 WSL 项目上反复失败时,我想要桌面应用直接以发行版的环境工作,而不必搬家、装服务或放弃沙箱。」
- **反受众(必须主动告知)**:CLI 能直接装进 distro 的用户不该用本插件——README「Do I need this plugin?」与 VALUE.zh.md 有完整对比。

## 定位与差异化

- 三件套:诚实边界(何时不用)、证据链(每条主张指向可复核证据/探针)、零足迹(无服务无端口,唯一持久物是内容寻址的 agent 缓存)。
- 心理学挂钩:Pratfall(示弱增信)、Contrast(before/after 演示)、IKEA+承诺一致(doctor 先行)、Peak-End(ready verdict 分享卡)、Authority(证据链接)。

## 红线(所有物料与文案)

1. DeepSeek/Harness 品牌元素使用前必读上游 `BRAND_GUIDELINES.md`。
2. 沙箱/隔离表述照抄仓库契约口径(`enforcement: "partial"`),不声称未执行的隔离。
3. 「何时不该用」段落必须出现在所有推广内容中。
4. 不使用灌水/自动化刷量手段;HN/Reddit 只发技术叙述。
5. 风格与 `AGENTS.md` 一致:结论先行、证据可复核、不夸大。

## 渠道等式(概要)

- E1 上游触点(关键路径) / E2 搜索面(npm keywords + GitHub topics) / E3 内容尖峰 / E4 工程即营销(doctor) / E5 存量答问。
- 每个 4 周判定窗口,按「每小时下载产出」3 倍判杀。

## 北星与度量

- 北星:周度 npm 下载;留存代理:新版本发布后 7 天内更新下载占比。
- 2 个月场景:downside 3.5k / baseline 4.5k / upside 8–9k(依赖上游触点成立)。

## 关键素材指针

`docs/VALUE.zh.md`(三处错位/六条价值)、`docs/PERFORMANCE.md`、`docs/QUICKSTART.md`、`docs/screenshots/`、`pnpm run doctor`、`test/probe/`。
