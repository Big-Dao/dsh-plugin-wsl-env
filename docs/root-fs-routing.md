# 根平面按坐标路由的 fs — 设计文档

> 状态：已实现，随 0.7.2 发布。源码是 `src/fs-routing.ts`，
> `lib/fs-routing.js` 是其编译产物；当前开发依赖及 peer 范围以
> `package.json` 为准。
> 时效：§5 的验证与回退小节于 2026-10-31 对照现行测试与探针清单复核
> （组合测试 12 项、单测 4 项、真机套件 15 项含 `fs-routing.sh`）；
> 其余章节保留设计时的历史表述。
> 关联：promotion-map 附录 C（workspace-files 接管评审）、附录 B（剩余 9P
> 消费者）、`docs/upstream/rfc-wsl-workspaces.md` 增补（根平面路由 fs 的
> 上游 seam 提案）。

## 1. 问题

desktop 组合的根 `ctx.fs`（`fs-sandbox` 行，`SandboxedFileSystem extends
LocalFileSystem`）是 session-less 的：它不知道会话，只知道部署默认的
workspace root。对一个 `\\wsl.localhost\<distro>` 工作区，它的每一次调用都
落在 9P share 上——读慢 200 倍、watch（chokidar v4 → `fs.watch`）在 9P 上
没有可用事件、写路径的 NTFS 原语（`GetFileSecurityW`/`ReplaceFileW`/硬链接）
直接失败。而 preset isolate 里的 `wsl-fs` 帮不到它：根消费者不经过 preset。

受影响的根消费者（调研确认）：

- `workspace-files` 的 **change feed**（`WorkspaceChangeFeed` →
  `ctx.fs.watch`）：WSL 工作区上 GUI 文件树不自动刷新；
- `workspace-changes` 的 fs 侧与未来任何根消费者（默认继承同样的 9P 命运）；
- LSP（未挂载）——若挂载，其 fs 调用也会落在这里（但 LSP 的完整解法是
  成对远程 provider，见 rfc 增补）。

## 2. 设计

`WslRoutingFileSystem extends LocalFileSystem`，替换根 `fs-sandbox` 行。
每个操作按**目标的坐标系**路由：

```
targetKey（或 path/cwd）是 \\wsl.localhost\<distro> UNC
  → distro substrate（懒加载的 WslFileSystem 实例：常驻 agent 上的
    canonical/stat/读/listDir/watch，使用目标路径所在的发行版文件系统）
否则（盘符、相对路径解析到盘符）
  → super（宿主 LocalFileSystem：NTFS 原生，含 chokidar watch）
```

一个 `WslFileSystem` 实例内部再按 UNC 的 distro 选择自己的 substrate、agent 与
home 缓存，所以同一个根平面可以同时服务多个发行版；`distro: ''`/`auto` 是默认，
显式名字才是 pin（此时外来 distro 仍由 `restrictToDistro` 拒绝）。

判定是**纯坐标**：不看会话、不看 preset。这正是"根平面 session-less"约束下
唯一自洽的形态——它不放弃 per-session 语义，因为根平面本来就没有；工具写入
的 per-session 围栏在 preset 的 `wsl-fs`/`fs-sandbox` 里，不在这里。

### 2.1 操作路由表

| 操作 | 判据 | distro 侧 | 宿主侧 |
|---|---|---|---|
| resolve / lstat | path 或 cwd 的坐标 | substrate resolve/lstat | super |
| stat / listDir / readText / streamText / readBytes / readByteRange | targetKey 坐标 | substrate 对应操作 | super |
| watch | targetKey 坐标 | distro inotify 或轮询（粗粒度失效） | chokidar |
| writeText / editText | targetKey 坐标 | distro 写（substrate 守卫 + confined agent 内核强制） | super |
| contains / processPath | parent/targetKey 坐标 | Linux 路径语义（`contains` 按两个目标的 `processPath` 做 POSIX 包含判定） | super |

未覆写的出口：本类覆写的是上表这 13 个方法，`fileUrl` 与
`processPathFromHostPath` 沿用宿主实现——「按坐标路由」不等于接口全覆盖。

- `fileUrl` 由继承的实现从 `processPath` 派生
  （`pathToFileURL(this.processPath(target)).href`，`dsh-fs-local/lib/index.js:795-796`）：
  distro 目标的 Linux 路径走的是**宿主平台**的编码路径，在 Windows 上 Node
  先 `path.win32.resolve` 它，`file:///home/...` 不是可靠的形态。接口把 URI
  编码留给后端，正是因为执行平台可能与宿主不同
  （`dsh-fs/lib/types/index.d.ts:117-123`）；真有消费者时需要按 POSIX 语义覆写。
- `processPathFromHostPath` 也是宿主实现（绝对宿主路径取 `resolve`）。被路由的
  `WslFileSystem` 自己有一份 distro 映射（`src/index.ts:1412`），那份映射不经
  本路由。

### 2.2 有意的行为差异（对照原根 fs-sandbox）

- **根围栏退役**：fs-sandbox 的 write 围栏（deployment workspaceRoot 词法
  检查）只护写路径，而根平面当前没有写消费者（tool-fs 的写在 preset）。
  distro 侧写入自带更强的围栏（Linux 前缀包含 + confined agent 内核强制）。
  文档明示：若未来出现根平面写消费者，围栏语义需随行。
- **UNC 目标的 `processPath` 变为 Linux 形态**：`processPath` 返回 distro
  路径，而读它的根消费者仍在——正是本路由所服务的 workspace-files change
  feed：它在每个 `change` 事件里发出 `ctx.fs.processPath(target)`
  （`@deepseek-ai/dsh-api-workspace-files/lib/index.js:92`），distro 工作区的事件路径因此
  是 Linux 形态。GUI 文件服务现在也用随包的 `workspace-files` 行，`stat`/读
  同样经 `ctx.fs.processPath`，两种形态一致；此前的 `workspace-files-wsl`
  接管把 `stat` 的 `absolutePath` 合成 UNC，已随该行删除。
  `fileUrl` 不在覆写之列（§2.1 注）：它由 `processPath` 派生，同样不能假定为
  `file:///home/...`。
- **watch 的事件粒度**：无限深目录且有 `inotifywait` 时，distro 侧优先使用
  inotify；文件目标、限深目录或缺少工具时回退轮询。回调是粗粒度失效而非
  逐文件事件；轮询的 mtime 盲点见 [LIMITATIONS.md](LIMITATIONS.md)。

### 2.3 懒加载与失败语义

distro 实例（WslFileSystem）在第一次 UNC 路由时构建；其内部的 distro 解析
（`wsl.exe -l -q`）与常驻 agent 启动都是懒的。失败语义沿用各层既有行为：
distro 停止 → substrate 报 `FS_IO_ERROR`（fail-closed，不回 9P）；bwrap
缺失 → confined 写拒绝并给出 bootstrap 指引；`sandbox: false` 是文档化的
退出项。

构建后端有三个 cordis 约束，改这里时必须保留：

- **状态不能用 `#private` 字段。** 服务方法由 cordis 以影子接收者调用
  （traceable proxy 的 `createShadowMethod`），私有成员不跨代理；`this.#distro`
  会抛 `Cannot read private member … from an object whose class did not
  declare it`。宿主基类自己的 `config` / `locks` 就是普通字段。
- **后端要在一个隔离了 `fs` 的子作用域里构造。** 它本身是 `Service`，构造时
  会注册 `fs`；用路由自己的作用域会得到 `service "fs" has been registered`。
  `isolate("fs")` 只重映射 `fs`，后端读取的 `sandboxPolicy` 仍从父作用域
  解析。构造上下文要在构造函数里捕获：服务方法里的 `this.ctx` 是**调用方**
  的上下文（cordis 用于依赖追踪），而首个路由调用可能来自任意消费者 fiber。
- **路由类要声明 `static inject = ["sandboxPolicy"]`。** 被路由的后端在构造
  时读取部署默认模式 `ctx.sandboxPolicy.defaultMode`；该服务由**兄弟行**
  提供，不是祖先，fiber 不声明依赖就取不到，会报
  `cannot get property "sandboxPolicy" without inject`。被本类替换的
  `fs-sandbox` 行同样声明了这一依赖。

## 3. 挂载

cordis.patch.yml：禁根 `fs-sandbox` 行 + 插入 `fs-routing` 行（本插件
export `./fs-routing`）。config 承载两侧旋钮：宿主侧 `cwd`/`diffBasisMaxBytes`
（原 LocalConfig），distro 侧 `distro`/`wslPath`/`distroCwd`/`sandbox`/
`maskWindowsDrive`/`restrictToDistro`/`watchMaxDepth`（原 wsl-fs 旋钮）。
分工要看准：`cwd` 只作用于宿主后端，distro 后端的工作目录是 `distroCwd`
（空 = distro 用户 home，即原 `wsl-fs` 的 `cwd`），而 `diffBasisMaxBytes`
两侧共用。逐键语义与默认值见 `docs/CONFIGURATION.md` 的 `fs-routing` 行。

## 4. 与其它件的关系

- **workspace-files 行不再替换**：GUI 文件树/预览使用随包的
  `workspace-files` 行，经本路由读写 WSL 路径；比原来的直连 agent 多 4–6 次
  往返（见 [LIMITATIONS](LIMITATIONS.md)）。本路由同时服务它的 `changes`
  流——那条流经根 fs 做 resolve/stat/watch/contains，并在每个事件里取
  `processPath`（§2.2）。
- **`@` 补全**：仍需上游 seam（遍历漏斗是模块内函数，不经 ctx.fs）——本路由
  帮不到它，RFC 增补①的提案不变。
- **晋升**：若上游收编，本模块即 RFC 增补②"coordinate-routing root
  filesystem"的实现底稿。

## 5. 验证与回退

仓库里可跑的：

- `node test/composition.test.mjs`：把本插件的 `cordis.patch.yml` 过真实的
  `applyEntryPatches`，再让 `fs-routing` 行真的经 Loader 启动，断言组合树里
  `fs-routing` 是真实的顶层行、`fs-sandbox` 按名禁用，以及
  `context.fs instanceof WslRoutingFileSystem`。同一检查随后**经 `ctx.fs`
  服务代理**调用 `distro()`，断言后端只构建一次、根 `fs` 不被后端的服务
  注册替换，并对整张路由表逐项断言坐标分派（distro 侧在 backend surface
  打桩，宿主侧落到临时目录）。0.2.1 的 `working-directory` 行经根
  `ctx.fs` 解析会话 cwd 时，正是这条路径第一次被真实消费者执行——
  cordis 的影子接收者会让 `#private` 字段抛错，二次注册 `fs` 会让后端构造
  抛错，缺 `sandboxPolicy` 注入会让构造抛错，三处回归都由该检查钉住。
  12/12 通过。
- `node test/fs-routing.test.mjs`：覆盖纯谓词与路径助手（`targetIsDistro`/
  `distroContains`/`inputIsDistro`/`linuxJoin`）；类本体改由上一项的组合测试经
  服务代理覆盖。该文件自 2026-10-19 起已在 `test:unit` 与 `test:coverage`
  清单里（`docs/REQUIREMENTS.zh.md` 的 OI-7，已解决）。
- 真机探针全套（`test/probe/run-all-when-closed.sh --include-fs`，14 项常规
  + `run.sh` 共 15 项）覆盖 agent、watch、substrate 等底座，并包含本路由的
  `test/probe/fs-routing.sh`：临时 profile 以本路由为根 `fs`，经 UNC 坐标读
  distro 内 ext4 文件、经盘符路径读 Windows 文件，并拒绝另一 distro 的 UNC。

真机上判断目标是哪个后端：在 distro 工作区里停掉 distro
（`wsl.exe --terminate <distro>`），根级对 UNC 目标的调用应 fail-closed 报
`FS_IO_ERROR`（§2.3），而不是回落到 9P；同一次验证里宿主盘符路径照常工作。

`changes` 与 `stat` 的 `absolutePath` 现在都来自 `ctx.fs.processPath`，都是
Linux 形态；客户端归一化后可比对。此前的 `workspace-files-wsl` 接管让
`stat` 返回 UNC、与 `changes` 不一致；该接管已删除，这一形态差异不再存在。

回退：`fs-routing` 是顶层行，可以在你自己的 profile 层
（`$DSH_HOME/profiles/<name>/cordis.patch.yml`，按 id 覆盖插件行）里恢复随发的
根 fs：

```yaml
- id: fs-routing
  disabled: true
- id: fs-sandbox
  disabled: false
```

此后 UNC 目标回到 9P（慢、无可用 watch 事件），也就是路由落地前的行为。这个
补丁的形状在本仓核对过：把它叠在插件补丁之后，`fs-sandbox` 的 `disabled`
回到 `false`、`fs-routing` 变为 `disabled: true`（用
`@deepseek-ai/cordis-plugin-include` 的 `applyEntryPatches` 实测）。
