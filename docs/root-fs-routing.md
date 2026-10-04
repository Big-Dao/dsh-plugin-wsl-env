# 根平面按坐标路由的 fs — 设计文档

> 状态：已实现（`lib/fs-routing.js`，本仓 0.7.1 后的下一版内容）。
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
| contains / processPath / fileUrl | parent/targetKey 坐标 | Linux 路径语义 | super |

### 2.2 有意的行为差异（对照原根 fs-sandbox）

- **根围栏退役**：fs-sandbox 的 write 围栏（deployment workspaceRoot 词法
  检查）只护写路径，而根平面当前没有写消费者（tool-fs 的写在 preset）。
  distro 侧写入自带更强的围栏（Linux 前缀包含 + confined agent 内核强制）。
  文档明示：若未来出现根平面写消费者，围栏语义需随行。
- **UNC 目标的 processPath/fileUrl 变为 Linux 形态**：`processPath` 返回
  distro 路径、`fileUrl` 返回 `file:///home/...`。当前唯一消费者
  （workspace-files）已被行替换接管、不再读根 fs 的这些出口；对未来消费者
  这是正确形态（ssh 家族同款语义）。
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
export `./fs-routing`）。config 承载两侧旋钮：宿主侧 `cwd`/
`diffBasisMaxBytes`（原 LocalConfig），distro 侧 `distro`/`wslPath`/
`sandbox`/`maskWindowsDrive`/`restrictToDistro`/`watchMaxDepth`（原
wsl-fs 旋钮）。

## 4. 与其它件的关系

- **workspace-files 行替换**（已落地）：继续快于本路由（四操作绕过 ctx.fs
  直连 agent）；本路由补的是它没接管的 `changes` watch 流。
- **`@` 补全**：仍需上游 seam（遍历漏斗是模块内函数，不经 ctx.fs）——本路由
  帮不到它，RFC 增补①的提案不变。
- **晋升**：若上游收编，本模块即 RFC 增补②"coordinate-routing root
  filesystem"的实现底稿。
