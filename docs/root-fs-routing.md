# 根平面按坐标路由的 fs — 设计文档

> 状态：已实现，随 0.7.2 发布（本仓当前 0.8.x）。源码是 `src/fs-routing.ts`，
> `lib/fs-routing.js` 是其编译产物；对照的 peer 为 `package.json` 锁定的
> 0.2.0-rc.2。
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
    canonical/stat/读/listDir/watch，全在 ext4 上）
否则（盘符、相对路径解析到盘符）
  → super（宿主 LocalFileSystem：NTFS 原生，含 chokidar watch）
```

判定是**纯坐标**：不看会话、不看 preset。这正是"根平面 session-less"约束下
唯一自洽的形态——它不放弃 per-session 语义，因为根平面本来就没有；工具写入
的 per-session 围栏在 preset 的 `wsl-fs`/`fs-sandbox` 里，不在这里。

### 2.1 操作路由表

| 操作 | 判据 | distro 侧 | 宿主侧 |
|---|---|---|---|
| resolve / lstat | path 或 cwd 的坐标 | substrate resolve/lstat | super |
| stat / listDir / readText / streamText / readBytes / readByteRange | targetKey 坐标 | substrate 对应操作 | super |
| watch | targetKey 坐标 | distro `find -newer` 轮询（真实事件） | chokidar |
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
  是 Linux 形态；行替换后的子类只接管 list/stat/read/readBytes，不覆写
  `changes`（`src/workspace-files-wsl.ts:10`），而同一次会话的 `stat` 由子类
  覆写、`absolutePath` 仍合成 UNC 形态（同文件 `:19-20`）——两种形态不一致的
  后果见 §5。
  `fileUrl` 不在覆写之列（§2.1 注）：它由 `processPath` 派生，同样不能假定为
  `file:///home/...`。
- **watch 的事件粒度**：distro 侧是 `find -newer` 轮询（粗粒度失效 + 已知
  盲点：mtime 早于 stamp 的文件），不是逐文件事件——与 preset 侧 watch 同一
  后端、同一限制。

### 2.3 懒加载与失败语义

distro 实例（WslFileSystem）在第一次 UNC 路由时构建；其内部的 distro 解析
（`wsl.exe -l -q`）与常驻 agent 启动都是懒的。失败语义沿用各层既有行为：
distro 停止 → substrate 报 `FS_IO_ERROR`（fail-closed，不回 9P）；bwrap
缺失 → confined 写拒绝并给出 bootstrap 指引；`sandbox: false` 是文档化的
退出项。

## 3. 挂载

cordis.patch.yml：禁根 `fs-sandbox` 行 + 插入 `fs-routing` 行（本插件
export `./fs-routing`）。config 承载两侧旋钮：宿主侧 `cwd`/`diffBasisMaxBytes`
（原 LocalConfig），distro 侧 `distro`/`wslPath`/`distroCwd`/`sandbox`/
`maskWindowsDrive`/`restrictToDistro`/`watchMaxDepth`（原 wsl-fs 旋钮）。
分工要看准：`cwd` 只作用于宿主后端，distro 后端的工作目录是 `distroCwd`
（空 = distro 用户 home，即原 `wsl-fs` 的 `cwd`），而 `diffBasisMaxBytes`
两侧共用。逐键语义与默认值见 `docs/CONFIGURATION.md` 的 `fs-routing` 行。

## 4. 与其它件的关系

- **workspace-files 行替换**（已落地）：继续快于本路由（四操作绕过 ctx.fs
  直连 agent）；本路由补的是它没接管的 `changes` 流——那条流经根 fs 做
  resolve/stat/watch/contains，并在每个事件里取 `processPath`（§2.2）。
- **`@` 补全**：仍需上游 seam（遍历漏斗是模块内函数，不经 ctx.fs）——本路由
  帮不到它，RFC 增补①的提案不变。
- **晋升**：若上游收编，本模块即 RFC 增补②"coordinate-routing root
  filesystem"的实现底稿。

## 5. 验证与回退

仓库里可跑的：

- `node test/composition.test.mjs`：把本插件的 `cordis.patch.yml` 过真实的
  `applyEntryPatches`，再让接管行真的经 Loader 启动，断言组合树里
  `fs-routing` 是真实的顶层行（`test/composition.test.mjs:126-131`）、
  `fs-sandbox` 按名禁用（`:113-117`），以及
  `context.fs instanceof WslRoutingFileSystem`（`:161`，该检查自 `:138` 起）。
  核对本文档时 9/9 通过。
- `node test/fs-routing.test.mjs`：只覆盖纯谓词与路径助手（`targetIsDistro`/
  `inputIsDistro`/`linuxJoin`）；类本体需要 DSH peers 与实机，不在其中
  （`test/fs-routing.test.mjs:2-4`），且该文件尚未进 `test:unit`/`test:coverage`
  清单（`docs/REQUIREMENTS.zh.md` 的 OI-7）。
- 真机探针全套（`test/probe/run-all-when-closed.sh --include-fs`，12 项）覆盖
  agent、watch、substrate 等底座，但没有一项针对本路由
  （`grep -rn "fs-routing" test/probe/*.sh` 无命中）。

真机上判断目标是哪个后端：在 distro 工作区里停掉 distro
（`wsl.exe --terminate <distro>`），根级对 UNC 目标的调用应 fail-closed 报
`FS_IO_ERROR`（§2.3），而不是回落到 9P；同一次验证里宿主盘符路径照常工作。

已知待确认：`changes` 事件里的 `absolutePath` 是 Linux 形态，而同一次会话
`stat` 的 `absolutePath` 是 UNC 形态；客户端把后者归一化后与前者比对
（`@deepseek-ai/dsh-api-workspace-files/lib/client.js:14-16`、`:40-41`、`:75`、
`:147`），形态不同即不投递。GUI 文件树的实时刷新是否因此失效，本文档没有
真机证据；若确认失效，修法在代码侧（给该流补一次坐标映射，或统一两个出口
的形态），不在本文档范围。

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
