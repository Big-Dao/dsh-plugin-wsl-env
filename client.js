/**
 * The plugin's web client: the navigation column's status panel and the
 * post-add access-mode prompt.
 *
 * The panel (`WSL 环境`) answers two questions: which distros are installed,
 * and whether one distro's environment is usable. The second answer is the
 * authoritative doctor verdict — the same standalone CLI the `/wsl-doctor`
 * command spawns — fetched from this plugin's own route,
 * `GET /api/wsl-env/status?distro=<name>`. The route lives on the Host
 * connection's authenticated exact-Fetch channel, which is why a browser plugin
 * can reach it without a generated client Remote. Checks run only when asked:
 * probing a stopped distro boots it, so a page load lists without probing.
 *
 * A checked row's second action is a full doctor run with `--fix-owned`
 * (`POST` on the same route). Its label follows what it can do: **修复** when
 * the report carries a finding the plugin can repair (a stale session scope or
 * a broken agent cache), **完整检查** otherwise. It never installs packages or
 * rewrites Windows-owned configuration; every other warning stays manual, and
 * the `fix.*` rows carry the before → after state.
 *
 * The last result is persisted Host-side, so a page reload (or an app restart)
 * still shows the last guidance and when it ran. On load, a stored result for
 * a distro that is currently running is re-checked in the background (never a
 * stopped one: a probe boots it); the result is labeled with its source, and
 * a failed background run overwrites the stored result truthfully.
 *
 * The panel opens no workspace and runs no session: adding a workspace still
 * happens where it always did. The only other surface is the access-mode
 * prompt, which asks once how a newly added distro workspace is opened. Its
 * Windows answer is persisted in this plugin's `auto-preset` row
 * (`windowsWorkspaces`, a volatile Settings field), and that row stops adopting
 * the WSL preset for those directories; the prompt also switches the
 * workspace's blank session back to the host preset so the answer applies
 * before the first turn.
 *
 * Loaded by the harness's web client loader through the `dsh.client`
 * declaration in package.json; the composition's bare-name row
 * (`wsl-env-client-host`, mounting the no-op root export) is what puts this
 * package on the web bundle list.
 */
window.__ModuleLoader__.load({
  id: "dsh-plugin-wsl-env",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;

    /** The plugin's status route (checks on GET, repair on POST); the row registers this exact path. */
    const STATUS_PATH = "/api/wsl-env/status";
    /** The launch route for opening a distro workspace in VS Code through Remote-WSL. */
    const OPEN_IN_APP_PATH = "/api/wsl-env/open-in-app";
    /** Sidebar panel id and order: below the shipped plugin/schedule entries. */
    const PANEL_ID = "wsl-env";
    const PANEL_ORDER = 25;
    /** Profile entry id of the row whose volatile field carries the access choice. */
    const AUTO_PRESET_ENTRY = "auto-preset";
    const WINDOWS_FIELD = "windowsWorkspaces";
    const UNC_RE = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(?:\\([\s\S]*))?$/i;

    const service = (ctx, name) => {
      try {
        return ctx.get(name);
      } catch (error) {
        return undefined;
      }
    };

    const messageOf = (error) => (error && typeof error.message === "string" ? error.message : String(error));

    const isWslUnc = (value) => typeof value === "string" && UNC_RE.test(value);

    const normalize = (value) => value.trim().replace(/[\\/]+$/, "").replace(/\//g, "\\").toLowerCase();

    const samePath = (a, b) => typeof a === "string" && typeof b === "string" && normalize(a) === normalize(b);

    /**
     * Fetch the route and decode its JSON answer.
     * @param query - the query string, including `?`, or empty.
     * @param method - `GET` for a check, `POST` for the repair action.
     * @returns the decoded body.
     * @throws with the route's own error message.
     */
    const statusRequest = async (query, method = "GET") => {
      const answer = await fetch(STATUS_PATH + (query ?? ""), { method });
      const body = await answer.json().catch(() => ({}));
      if (!answer.ok) throw new Error(body.error ?? `状态接口返回 ${answer.status}`);
      return body;
    };

    // ── Access-mode records ────────────────────────────────────────────────
    // The choice lives in the auto-preset row so the host can honor it without
    // a plugin-specific client Remote (the Client Remote assembly fixes its
    // namespaces at build time). Settings reads/writes go through the shipped
    // namespace.

    /**
     * Find the auto-preset settings view and its Windows-access paths.
     * @param describe - the `settings.describe` answer.
     * @returns the namespace view and the paths it currently carries.
     */
    const accessViewOf = (describe) => {
      if (!describe || describe.ok !== true) return undefined;
      const value = describe.value;
      if (!value || value.writable !== true || !Array.isArray(value.namespaces)) return undefined;
      // The composed entry id is the patch row id (`auto-preset`); a profile that
      // nests the bundle under an include may qualify it, so accept that shape too.
      const entry = value.namespaces.find((row) => row
        && (row.ns === AUTO_PRESET_ENTRY || row.ns.endsWith("/" + AUTO_PRESET_ENTRY)));
      if (entry === undefined) return undefined;
      const configured = entry.value && Array.isArray(entry.value[WINDOWS_FIELD]) ? entry.value[WINDOWS_FIELD] : [];
      // The row's `preset` field is the preset auto-preset adopts for distro
      // workspaces; the reminder compares the session's projection against it.
      const preset = entry.value && typeof entry.value.preset === "string" ? entry.value.preset : "";
      return { entry, paths: configured.filter((path) => typeof path === "string"), preset };
    };

    /**
     * Read the current Windows-access paths and the target preset.
     * @param ctx - client root context.
     * @returns `{ ok: true, paths, preset }`, or the reason the record is unavailable.
     */
    const readAccess = async (ctx) => {
      const settings = service(ctx, "remote.settings");
      if (settings === undefined) return { ok: false, message: "设置服务不可用" };
      const describe = await settings.describe();
      const view = accessViewOf(describe);
      if (view === undefined) return { ok: false, message: "auto-preset 配置不可写（或未装配）" };
      return { ok: true, paths: view.paths, preset: view.preset };
    };

    /**
     * Persist a complete Windows-access list.
     * @param ctx - client root context.
     * @param paths - the new list.
     * @returns `undefined` on success, or the failure message.
     */
    const writeAccess = async (ctx, paths) => {
      const settings = service(ctx, "remote.settings");
      if (settings === undefined) return "设置服务不可用";
      const describe = await settings.describe();
      const view = accessViewOf(describe);
      if (view === undefined) return "auto-preset 配置不可写（或未装配）";
      const patch = { [WINDOWS_FIELD]: paths };
      const answer = await settings.update(view.entry.ns, patch, view.entry.revision);
      if (answer.ok !== true) return answer.error?.message ?? "设置写入被拒绝";
      return undefined;
    };

    // ── The host-mode reminder ─────────────────────────────────────────────
    // A distro workspace can run the host preset without the operator meaning
    // to: it was recorded as Windows access (9p), the session began before
    // auto-preset could switch it, or the profile composes no WSL preset. In
    // each case the session runs PowerShell with 9p file access while its path
    // still says "WSL"; the composer dock carries a persistent warning with the
    // fix that actually applies, and the session header keeps a quiet badge after
    // the warning is collapsed.

    /** The preset auto-preset adopts when the row does not name one. */
    const PRESET_FALLBACK = "wsl";

    /**
     * Whether a workspace is one of the recorded Windows-access directories or
     * below one (whole-segment, case-insensitive, like the host's comparison).
     * @param cwd - the session workspace.
     * @param paths - the configured directories.
     * @returns true when the workspace opted out of the distro environment.
     */
    const isWindowsAccessPath = (cwd, paths) => {
      const target = normalize(cwd);
      return paths.some((entry) => {
        if (typeof entry !== "string" || entry.trim() === "") return false;
        const base = normalize(entry);
        return target === base || target.startsWith(base + "\\");
      });
    };

    /**
     * The distro a UNC workspace names.
     * @param cwd - the session workspace.
     * @returns the distro name, or undefined for a non-UNC path.
     */
    const distroOf = (cwd) => {
      const match = typeof cwd === "string" ? UNC_RE.exec(cwd) : null;
      return match === null ? undefined : match[1];
    };

    /**
     * The reminder state for one session, or null when its environment is right.
     * A missing projection and a matching preset both mean "nothing to say": the
     * banner never guesses an environment.
     * @param input - the session workspace, its projected preset, the configured
     *   target preset, the Windows-access list, and subagent membership.
     * @returns `{ target, windowsAccess }` for a distro workspace on a non-WSL preset.
     */
    const hostModeOf = ({ cwd, preset, target, paths, subagent }) => {
      if (subagent === true || !isWslUnc(cwd)) return null;
      if (typeof preset !== "string" || preset === "" || preset === target) return null;
      return { target, windowsAccess: isWindowsAccessPath(cwd, paths ?? []) };
    };

    /** The sessionStorage key that collapses the warning for one session. */
    const dismissedKey = (sessionId) => "wsl-env.access-mode.dismissed:" + String(sessionId);

    /**
     * Whether the operator collapsed the reminder for this session.
     * @param sessionId - the session to ask about.
     * @returns true when the warning was dismissed in this browser session.
     */
    const readDismissed = (sessionId) => {
      try {
        return window.sessionStorage.getItem(dismissedKey(sessionId)) === "1";
      } catch {
        return false;
      }
    };

    /**
     * Collapse the reminder for this session only; a new session asks again.
     * @param sessionId - the session to collapse.
     */
    const rememberDismissed = (sessionId) => {
      try {
        window.sessionStorage.setItem(dismissedKey(sessionId), "1");
      } catch {
        /* a browser without storage keeps the reminder visible */
      }
    };

    /**
     * Follow one session's host-mode state.
     * @param ctx - client root context.
     * @param sessionId - the active session.
     * @param useSessions - the slot's session-list hook.
     * @param useProjection - the slot's projection hook.
     * @returns the session summary and the reminder state (null while loading or correct).
     */
    const useHostMode = (ctx, sessionId, useSessions, useProjection) => {
      const summary = useSessions((state) => state.byId[sessionId]);
      const preset = useProjection("agentPreset");
      const cwd = summary?.cwd;
      const [access, setAccess] = useState(null);

      useEffect(() => {
        let live = true;
        // Read the record only when the projection already says "not the WSL
        // preset": a normal distro session never pays the settings round trip.
        if (!isWslUnc(cwd) || typeof preset !== "string" || preset === "" || preset === PRESET_FALLBACK) {
          setAccess(null);
          return () => { live = false; };
        }
        void (async () => {
          let answer;
          try {
            answer = await readAccess(ctx);
          } catch {
            // A settings read that throws is the same "record unavailable"
            // state as one that answers `ok: false`: warn visibly with the
            // fallback target instead of leaving the session silent.
            answer = { ok: false };
          }
          if (!live) return;
          setAccess(answer.ok === true
            ? {
              target: typeof answer.preset === "string" && answer.preset !== "" ? answer.preset : PRESET_FALLBACK,
              paths: answer.paths,
            }
            : { target: PRESET_FALLBACK, paths: [] });
        })();
        return () => { live = false; };
      }, [cwd, preset]);

      const subagent = summary?.parentId !== undefined || summary?.origin === "subagent";
      return {
        summary,
        state: access === null
          ? null
          : hostModeOf({ cwd, preset, target: access.target, paths: access.paths, subagent }),
      };
    };

    /**
     * The persistent composer-dock warning for a distro workspace running the
     * host environment. The primary action is the one that works for this
     * session: a blank session can be switched in place; a session that already
     * started a turn keeps its history, so the durable fix is the access record.
     * @param props - slot standard props plus the client root context.
     * @returns the warning bar, or null when the environment is right or collapsed.
     */
    function AccessModeBanner({ ctx, sessionId, useSessions, useProjection }) {
      const { summary, state } = useHostMode(ctx, sessionId, useSessions, useProjection);
      const [dismissed, setDismissed] = useState(() => readDismissed(sessionId));
      const [removed, setRemoved] = useState(false);
      const [busy, setBusy] = useState(false);
      const [notice, setNotice] = useState(null);

      useEffect(() => {
        setDismissed(readDismissed(sessionId));
        setRemoved(false);
        setNotice(null);
      }, [sessionId]);

      if (state === null || dismissed) return null;
      const blank = summary?.blank === true;

      /** Switch this blank session to the configured WSL preset, in place. */
      const switchToWsl = async () => {
        setBusy(true);
        setNotice(null);
        try {
          const presets = service(ctx, "remote.agentPresets");
          if (presets === undefined) throw new Error("会话服务不可用");
          const answer = await presets.select(sessionId, state.target);
          if (answer.ok !== true) throw new Error(answer.error?.message ?? "preset 切换失败");
          // The projection flips to the WSL preset and the banner unmounts; also
          // drop the recorded Windows-access path so later sessions start right.
          if (state.windowsAccess && summary?.cwd !== undefined) {
            const current = await readAccess(ctx);
            if (current.ok === true) {
              const failure = await writeAccess(ctx, current.paths.filter((entry) => !samePath(entry, summary.cwd)));
              if (failure !== undefined) setNotice({ kind: "warn", text: `已切换，但写入访问方式失败：${failure}` });
            }
          }
        } catch (error) {
          setNotice({ kind: "error", text: `切换失败：${messageOf(error)}（若 WSL preset 未装配，请运行 /wsl-doctor 检查）` });
        } finally {
          setBusy(false);
        }
      };

      /** Drop the recorded Windows-access directory; this session keeps its history. */
      const forgetWindowsAccess = async () => {
        setBusy(true);
        setNotice(null);
        try {
          const cwd = summary?.cwd;
          if (typeof cwd !== "string") throw new Error("工作目录未知");
          const current = await readAccess(ctx);
          if (current.ok !== true) throw new Error(current.message);
          const failure = await writeAccess(ctx, current.paths.filter((entry) => !samePath(entry, cwd)));
          if (failure !== undefined) throw new Error(failure);
          setRemoved(true);
          setNotice({ kind: "ok", text: "已记录：本工作区新开的会话将使用 WSL 模式；本会话仍保持宿主模式。" });
        } catch (error) {
          setNotice({ kind: "error", text: `写入失败：${messageOf(error)}` });
        } finally {
          setBusy(false);
        }
      };

      const collapse = () => {
        rememberDismissed(sessionId);
        setDismissed(true);
      };

      return h(
        "div",
        { role: "status", style: styles.accessBanner },
        h(
          "div",
          { style: styles.accessBannerBody },
          h("div", { style: styles.accessBannerTitle }, "当前会话运行在 Windows 宿主模式"),
          h("div", { style: styles.accessBannerText },
            `此工作区在 WSL 发行版 ${distroOf(summary?.cwd) ?? "WSL"} 内，但没有使用 WSL 环境：命令走 Windows PowerShell，文件访问经 9p 共享，没有 Linux 工具链。`,
            state.windowsAccess ? "该目录记录为“Windows 访问”。" : null),
          notice === null ? null : h(
            "div",
            { style: notice.kind === "ok" ? styles.noticeOk : styles.notice },
            notice.text,
          ),
        ),
        h(
          "div",
          { style: styles.accessBannerActions },
          blank && !busy
            ? h(Btn, { label: "切换为 WSL 模式", primary: true, onClick: () => { void switchToWsl(); } })
            : null,
          !blank && state.windowsAccess && !removed && !busy
            ? h(Btn, { label: "以后用 WSL 打开", onClick: () => { void forgetWindowsAccess(); } })
            : null,
          !blank && !state.windowsAccess
            ? h("span", { style: styles.hint }, "本会话已固定为宿主模式；新建会话时选择 WSL 模式。")
            : null,
          h(Btn, { label: "收起", small: true, onClick: collapse }),
        ),
      );
    }

    /**
     * The quiet session-header marker that survives collapsing the banner.
     * @param props - slot standard props plus the client root context.
     * @returns the badge, or null when the environment is right or the banner shows.
     */
    function AccessModeBadge({ ctx, sessionId, useSessions, useProjection }) {
      const { summary, state } = useHostMode(ctx, sessionId, useSessions, useProjection);
      const [dismissed, setDismissed] = useState(() => readDismissed(sessionId));
      useEffect(() => { setDismissed(readDismissed(sessionId)); }, [sessionId]);
      if (state === null || !dismissed) return null;
      return h(
        "span",
        {
          style: styles.accessBadge,
          title: `此工作区在 WSL 发行版 ${distroOf(summary?.cwd) ?? "WSL"} 内，但当前会话运行在 Windows 宿主模式（PowerShell、9p 共享，没有 Linux 工具链）。`,
        },
        "Windows 模式",
      );
    }

    /**
     * Switch one workspace's still-blank sessions to the host default preset.
     * @param ctx - client root context.
     * @param workspaceId - the workspace whose sessions to revisit.
     * @returns the first failure message, or undefined when every eligible session moved.
     */
    const switchWorkspaceSessions = async (ctx, workspaceId) => {
      const presets = service(ctx, "remote.agentPresets");
      const sessions = service(ctx, "sessions");
      const workspaces = service(ctx, "workspaces");
      if (presets === undefined || sessions === undefined || workspaces === undefined) return "会话服务不可用";
      const roster = await presets.list();
      if (roster.ok !== true) return roster.error?.message ?? "无法读取 preset 清单";
      const entries = Array.isArray(roster.value?.presets) ? roster.value.presets : [];
      const fallback = entries.find((entry) => entry && entry.isDefault === true);
      if (fallback === undefined || typeof fallback.id !== "string") return "找不到宿主默认 preset";
      const workspace = workspaces.list.getSnapshot().items.find((item) => item.workspaceId === workspaceId);
      if (workspace === undefined) return undefined;
      let failure;
      for (const sessionId of workspace.sessionIds) {
        const summary = sessions.list.getSnapshot().byId[sessionId];
        // A blank session still accepts a preset; one that started a turn keeps
        // the history it was produced under, and the host refuses the switch.
        if (summary === undefined || summary.blank !== true) continue;
        const answer = await presets.select(sessionId, fallback.id);
        if (answer.ok !== true && failure === undefined) failure = answer.error?.message ?? "preset 切换失败";
      }
      return failure;
    };

    // ── Presentation primitives ────────────────────────────────────────────

    const styles = {
      panel: {
        boxSizing: "border-box",
        height: "100%",
        overflowY: "auto",
        padding: "24px 28px 40px",
        fontSize: 13,
        lineHeight: 1.55,
      },
      inner: {
        maxWidth: 780,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      },
      title: { fontSize: 20, fontWeight: 600, letterSpacing: 0.2 },
      subtitle: { fontSize: 12, opacity: 0.6, marginTop: 2 },
      card: {
        border: "1px solid rgba(128, 128, 128, 0.28)",
        borderRadius: 10,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      },
      cardHead: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        justifyContent: "space-between",
      },
      cardTitle: { fontSize: 13, fontWeight: 600 },
      hint: { fontSize: 12, opacity: 0.6 },
      row: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "8px 10px",
        borderRadius: 6,
        border: "1px solid rgba(128, 128, 128, 0.16)",
      },
      rowHead: { display: "flex", alignItems: "center", gap: 10 },
      rowName: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      empty: { fontSize: 12, opacity: 0.55, padding: "4px 2px" },
      notice: { fontSize: 12, color: "#ff8f6b" },
      noticeOk: { fontSize: 12, color: "#5ecf86" },
      noticeInfo: { fontSize: 12, opacity: 0.7 },
      detail: { fontSize: 12, opacity: 0.8, display: "flex", flexDirection: "column", gap: 3 },
      repair: { fontSize: 12, wordBreak: "break-word" },
      failure: { fontSize: 12, opacity: 0.85, wordBreak: "break-word" },
      warning: { fontSize: 12, opacity: 0.75, wordBreak: "break-word" },
      accessBanner: {
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        margin: "0 12px 8px",
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid rgba(224, 176, 74, 0.55)",
        background: "rgba(224, 176, 74, 0.12)",
        fontSize: 12,
        lineHeight: 1.45,
        pointerEvents: "auto",
      },
      accessBannerBody: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 },
      accessBannerTitle: { fontWeight: 600 },
      accessBannerText: { opacity: 0.85, wordBreak: "break-word" },
      accessBannerActions: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" },
      accessBadge: {
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 8px",
        borderRadius: 999,
        fontSize: 11,
        border: "1px solid rgba(224, 176, 74, 0.55)",
        background: "rgba(224, 176, 74, 0.12)",
        color: "#e0b04a",
        whiteSpace: "nowrap",
        cursor: "default",
      },
      code: { fontFamily: "var(--dsh-font-family-code, ui-monospace, monospace)", opacity: 0.9 },
      fixableTag: { fontSize: 11, color: "#5ecf86", marginLeft: 4, marginRight: 4 },
      summary: { display: "flex", flexDirection: "column", gap: 3, fontSize: 12 },
      summaryLine: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" },
      summaryMuted: { opacity: 0.55 },
      refreshTag: { fontSize: 12, color: "#e0b04a" },
      countOk: { color: "#5ecf86" },
      countWarn: { color: "#e0b04a" },
      countFail: { color: "#ff8f6b" },
      sectionChip: { border: "1px solid rgba(128, 128, 128, 0.2)", borderRadius: 4, padding: "0 5px", fontSize: 11.5 },
      checkDetails: { display: "flex", flexDirection: "column", gap: 4, marginTop: 2 },
      detailToggle: {
        alignSelf: "flex-start",
        padding: 0,
        border: "none",
        background: "transparent",
        color: "inherit",
        opacity: 0.65,
        fontSize: 12,
        cursor: "pointer",
        textDecoration: "underline",
        textUnderlineOffset: 2,
      },
      checkBody: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        borderLeft: "2px solid rgba(128, 128, 128, 0.22)",
        paddingLeft: 8,
      },
      checkGroup: { display: "flex", flexDirection: "column", gap: 2 },
      checkGroupHead: { fontSize: 11, opacity: 0.5, letterSpacing: 0.3 },
      checkRow: { fontSize: 12, opacity: 0.85, wordBreak: "break-word" },
      checkMark: { display: "inline-block", width: 14 },
      checkRemedy: { opacity: 0.6 },
    };

    /** Verdict colors: ready / blocked / error / idle. */
    const verdictColors = {
      ready: { fg: "#5ecf86", bg: "rgba(94, 207, 134, 0.14)" },
      blocked: { fg: "#ff8f6b", bg: "rgba(255, 143, 107, 0.14)" },
      error: { fg: "#e0b04a", bg: "rgba(224, 176, 74, 0.14)" },
      idle: { fg: "inherit", bg: "rgba(128, 128, 128, 0.14)" },
    };

    /**
     * One status pill.
     * @param props - label, tone, and optional tooltip.
     * @returns the pill element.
     */
    function Pill({ label, tone, title }) {
      const color = verdictColors[tone] ?? verdictColors.idle;
      return h(
        "span",
        {
          title,
          style: {
            padding: "1px 8px",
            borderRadius: 999,
            fontSize: 11.5,
            lineHeight: "18px",
            whiteSpace: "nowrap",
            color: color.fg,
            background: color.bg,
          },
        },
        label,
      );
    }

    /**
     * One neutral button; the caller supplies emphasis.
     * @param props - label, click handler, and optional emphasis/disabled.
     * @returns the button element.
     */
    function Btn({ label, onClick, primary, disabled, small }) {
      return h(
        "button",
        {
          type: "button",
          onClick,
          disabled: disabled === true,
          style: {
            padding: small === true ? "3px 9px" : "6px 12px",
            borderRadius: 6,
            fontSize: small === true ? 12 : 12.5,
            border: "1px solid rgba(128, 128, 128, 0.35)",
            background: primary === true ? "rgba(86, 132, 255, 0.18)" : "transparent",
            color: "inherit",
            opacity: disabled === true ? 0.5 : 1,
            cursor: disabled === true ? "default" : "pointer",
            whiteSpace: "nowrap",
          },
        },
        label,
      );
    }

    /**
     * The sidebar glyph: a terminal window.
     * @param props - requested size and selection state.
     * @returns the icon element.
     */
    function WslIcon({ size, active }) {
      const edge = typeof size === "number" ? size : 16;
      return h(
        "svg",
        {
          width: edge,
          height: edge,
          viewBox: "0 0 16 16",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.4,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          opacity: active === true ? 1 : 0.85,
          "aria-hidden": "true",
        },
        h("rect", { x: 1.6, y: 2.4, width: 12.8, height: 11.2, rx: 2 }),
        h("path", { d: "M4.4 6.2l2.1 1.8-2.1 1.8" }),
        h("path", { d: "M8.6 9.8h3.1" }),
      );
    }

    /**
     * A titled card.
     * @param props - title, optional head actions, and children.
     * @returns the card element.
     */
    function Card({ title, actions, children }) {
      return h(
        "section",
        { style: styles.card },
        h("div", { style: styles.cardHead }, h("div", { style: styles.cardTitle }, title), actions ?? null),
        children,
      );
    }

    /**
     * The pill for one distro's check state.
     * @param props - the cached check state, if any.
     * @returns the pill element.
     */
    function CheckPill({ state }) {
      if (state === undefined || state.phase === undefined) return h(Pill, { label: "未检查", tone: "idle" });
      if (state.phase === "checking") return h(Pill, { label: "检查中…", tone: "idle" });
      if (state.phase === "repairing") {
        return h(Pill, {
          label: state.mode === "full" ? "检查中…" : "修复中…",
          tone: "idle",
          title: state.mode === "full" ? "正在运行完整检查（无可自动修复项）" : "正在运行完整检查并修复插件自有状态",
        });
      }
      if (state.phase === "refreshing") return h(Pill, { label: "复核中…", tone: "idle", title: "面板正在后台复核上次结果" });
      if (state.phase === "error") return h(Pill, { label: "无法检查", tone: "error" });
      if (state.verdict === "ready") return h(Pill, { label: "正常", tone: "ready" });
      if (state.verdict === "blocked") {
        const count = Array.isArray(state.failures) ? state.failures.length : 0;
        const label = count > 0 ? `异常 · ${count} 项` : state.cached === true ? "异常" : "有告警";
        return h(Pill, { label, tone: "blocked" });
      }
      return h(Pill, { label: "检查失败", tone: "error" });
    }

    /**
     * A numbered list of doctor findings.
     * @param props - heading, findings, whether they block, and the ids the
     *   repair action can act on.
     * @returns the list, or null when there is nothing to show.
     */
    function IssueList({ heading, items, severity, repairable }) {
      if (!Array.isArray(items) || items.length === 0) return null;
      return h(
        "div",
        null,
        h("div", { style: { opacity: 0.7, marginBottom: 2 } }, heading),
        items.map((item, index) => h(
          "div",
          {
            key: `${String(item.id ?? "item")}-${String(index)}`,
            style: severity === "warn" ? styles.warning : styles.failure,
          },
          h("span", { style: { opacity: 0.6, marginRight: 4 } }, `${String(index + 1)}.`),
          h("span", { style: styles.code }, item.id),
          Array.isArray(repairable) && repairable.includes(item.id)
            ? h("span", { style: styles.fixableTag }, "可自动修复")
            : null,
          " — ",
          item.detail ? `${item.detail}${item.remedy ? "；" : ""}` : "",
          item.remedy ?? "",
        )),
      );
    }

    /**
     * The repair action's own rows: what the doctor did, with its status mark.
     * @param props - the `fix.*` rows the repair answered with.
     * @returns the list, or null when the run has no repair rows.
     */
    function RepairList({ items }) {
      if (!Array.isArray(items) || items.length === 0) return null;
      return h(
        "div",
        null,
        h("div", { style: { opacity: 0.7, marginBottom: 2 } }, `修复动作（${String(items.length)}）`),
        items.map((item, index) => h(
          "div",
          {
            key: `${String(item.id ?? "fix")}-${String(index)}`,
            style: styles.detail,
          },
          h(
            "div",
            { style: styles.repair },
            h("span", { style: { opacity: 0.6, marginRight: 4 } }, item.status === "ok" ? "✓" : "!"),
            h("span", { style: styles.code }, String(item.title ?? item.id ?? "")),
            " — ",
            String(item.detail ?? ""),
          ),
          item.remedy === undefined ? null : h("div", { style: styles.warning }, String(item.remedy)),
        )),
      );
    }

    /**
     * The expandable per-check detail: every check the run executed, grouped
     * by the doctor's section order, with its status and evidence. A green row
     * is an assertion ("normal"), and this list is what backs it; a blocked row
     * shows the same rows the failures came from, so nothing is hidden. The
     * catalog rows a quick run never executed are counted in one line instead
     * of listed as fake "not run" checks.
     * @param props - the cached check state.
     * @returns the toggle and, open, the grouped list.
     */
    function CheckDetails({ state }) {
      const [open, setOpen] = useState(false);
      const checks = Array.isArray(state?.checks) ? state.checks : [];
      if (checks.length === 0) return null;
      const order = ["host", "sandbox", "session", "conf", "net", "agent"];
      const groups = order
        .map((section) => ({ section, rows: checks.filter((row) => row.section === section) }))
        .filter((group) => group.rows.length > 0);
      const other = checks.filter((row) => !order.includes(row.section));
      if (other.length > 0) groups.push({ section: "other", rows: other });
      const mark = (status) => status === "ok" ? "✓" : status === "fail" ? "✗" : status === "warn" ? "!" : status === "unknown" ? "?" : status === "skipped" ? "-" : "i";
      const tone = (status) => status === "ok" ? styles.countOk : status === "fail" ? styles.countFail : status === "warn" || status === "unknown" ? styles.countWarn : styles.summaryMuted;
      return h(
        "div",
        { style: styles.checkDetails },
        h("button", {
          type: "button",
          "aria-expanded": open,
          onClick: () => setOpen((previous) => !previous),
          style: styles.detailToggle,
        }, open ? "收起检查详情" : `查看检查详情（${String(checks.length)} 项）`),
        open
          ? h(
            "div",
            { style: styles.checkBody },
            groups.map((group) => h(
              "div",
              { key: group.section, style: styles.checkGroup },
              h("div", { style: styles.checkGroupHead }, `${group.section}（${String(group.rows.length)}）`),
              group.rows.map((row) => h(
                "div",
                { key: row.id, style: styles.checkRow },
                h("span", { style: { ...styles.checkMark, ...tone(row.status) } }, mark(row.status)),
                h("span", { style: styles.code }, String(row.id)),
                row.detail ? ` — ${String(row.detail)}` : "",
                row.remedy ? h("span", { style: styles.checkRemedy }, ` 处理：${String(row.remedy)}`) : null,
              )),
            )),
            typeof state.notRun === "number" && state.notRun > 0
              ? h("div", { style: styles.hint }, `本次是快速检查，只覆盖首条命令的前置项；完整检查还会运行 ${String(state.notRun)} 项（agent 链路、工具、网络、配置等）。`)
              : null,
          )
          : null,
      );
    }

    /**
     * Format a check timestamp with a relative hint.
     * @param at - epoch milliseconds.
     * @returns the display label.
     */
    const checkedLabel = (at) => {
      const date = new Date(at);
      const now = Date.now();
      const minutes = Math.max(0, Math.floor((now - at) / 60_000));
      const relative = minutes < 1
        ? "刚刚"
        : minutes < 60
          ? `${String(minutes)} 分钟前`
          : minutes < 1440
            ? `${String(Math.floor(minutes / 60))} 小时前`
            : `${String(Math.floor(minutes / 1440))} 天前`;
      const stamp = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
      return `${stamp}（${relative}）`;
    };

    /**
     * The result's structure: when the check ran and how its rows landed.
     * @param props - the cached check state.
     * @returns the summary block.
     */
    function ResultSummary({ state }) {
      const counts = state.counts ?? {};
      const statuses = [
        ["通过", counts.ok, styles.countOk],
        ["告警", counts.warn, styles.countWarn],
        ["失败", counts.fail, styles.countFail],
        ["未知", counts.unknown, styles.countWarn],
        ["信息", counts.info, styles.summaryMuted],
        ["跳过", counts.skipped, styles.summaryMuted],
      ].filter(([, n]) => typeof n === "number" && n > 0);
      const sections = Array.isArray(state.sections) ? state.sections : [];
      return h(
        "div",
        { style: styles.summary },
        h(
          "div",
          { style: styles.summaryLine },
          h("span", { style: styles.summaryMuted }, state.verdict === "error" ? "尝试检查：" : "上次检查："),
          h("span", null, typeof state.checkedAt === "number" ? checkedLabel(state.checkedAt) : "时间未知"),
          h("span", { style: styles.summaryMuted }, state.repaired === true
            ? (Array.isArray(state.repairs) && state.repairs.length > 0 ? "完整检查 · 已修复" : "完整检查")
            : "快速检查"),
          h("span", { style: styles.summaryMuted }, `来源：${state.source === "background" ? "后台" : "手动"}`),
          state.cached === true ? h("span", { style: styles.summaryMuted }, "缓存结果") : null,
          state.phase === "refreshing" ? h("span", { style: styles.refreshTag }, "后台复核中…") : null,
        ),
        state.verdict === "error" ? null : h(
          "div",
          { style: styles.summaryLine },
          statuses.map(([label, n, color]) => h("span", { key: String(label), style: color }, `${String(label)} ${String(n)}`)),
          statuses.length === 0 ? h("span", { style: styles.summaryMuted }, "没有可汇总的检查项") : null,
        ),
        state.verdict === "error" || sections.length === 0 ? null : h(
          "div",
          { style: styles.summaryLine },
          h("span", { style: styles.summaryMuted }, "分区："),
          sections.map((section) => {
            const parts = [];
            if (section.ok > 0) parts.push(`通过 ${String(section.ok)}`);
            if (section.warn > 0) parts.push(`告警 ${String(section.warn)}`);
            if (section.fail > 0) parts.push(`失败 ${String(section.fail)}`);
            if (section.unknown > 0) parts.push(`未知 ${String(section.unknown)}`);
            return h(
              "span",
              { key: section.section, style: styles.sectionChip },
              h("span", { style: { opacity: 0.7, marginRight: 4 } }, section.section),
              parts.length > 0 ? parts.join("、") : "无结论",
            );
          }),
        ),
      );
    }

    // ── The panel ──────────────────────────────────────────────────────────

    /**
     * The WSL environment page: the installed distros, their quick verdicts, and
     * the directories recorded for Windows access.
     * @param props - the client root context.
     * @returns the page element.
     */
    function WslPanel({ ctx }) {
      const [phase, setPhase] = useState("loading");
      const [distros, setDistros] = useState([]);
      const [checks, setChecks] = useState({});
      const [notice, setNotice] = useState(null);
      const [accessPaths, setAccessPaths] = useState(null);

      /** Re-read the Windows-access record (best effort; the panel still works without it). */
      const loadAccessPaths = async () => {
        try {
          const current = await readAccess(ctx);
          setAccessPaths(current.ok === true ? current.paths : []);
        } catch {
          setAccessPaths([]);
        }
      };

      /**
       * Re-check one already-running distro without the user asking. The row
       * keeps its previous summary until the answer arrives; a doctor failure
       * comes back as a normal error verdict (and is stored), while a
       * transport failure leaves the row with the reason it has no result.
       * @param distro - the distro to re-check.
       */
      const refreshBackground = async (distro) => {
        setChecks((previous) => {
          const current = previous[distro];
          if (current === undefined || current.phase === "refreshing") return previous;
          return { ...previous, [distro]: { ...current, phase: "refreshing" } };
        });
        try {
          const answer = await statusRequest(`?distro=${encodeURIComponent(distro)}&refresh=1&background=1`);
          setChecks((previous) => ({ ...previous, [distro]: { phase: "done", ...answer } }));
        } catch (error) {
          setChecks((previous) => ({ ...previous, [distro]: { ...previous[distro], phase: "error", error: messageOf(error) } }));
        }
      };

      /**
       * Load the distro list and the stored results.
       * @param allowBackground - whether running distros' stored results may be
       *   re-checked in the background (the initial load only, not a manual
       *   refresh: a refresh is a list read, not a probe).
       */
      const loadDistros = async (allowBackground = false) => {
        setPhase("loading");
        setNotice(null);
        try {
          const answer = await statusRequest("");
          setDistros(Array.isArray(answer.distros) ? answer.distros : []);
          const cached = {};
          for (const entry of Array.isArray(answer.cached) ? answer.cached : []) {
            cached[entry.distro] = { phase: "done", ...entry, cached: true };
          }
          setChecks(cached);
          setPhase("ready");
          if (allowBackground) {
            const running = new Set(Array.isArray(answer.running) ? answer.running : []);
            for (const entry of Array.isArray(answer.cached) ? answer.cached : []) {
              // A result from the last minute is already current; an error is
              // not retried automatically (the row's check button is the way
              // back), so a persistent failure cannot spin on every load.
              const recent = typeof entry.checkedAt === "number" && Date.now() - entry.checkedAt < 60_000;
              if (running.has(entry.distro) && entry.verdict !== "error" && !recent) void refreshBackground(entry.distro);
            }
          }
        } catch (error) {
          setPhase("error");
          setNotice({ kind: "error", text: messageOf(error) });
        }
      };

      useEffect(() => {
        // The first load may refresh stored results for running distros; the
        // manual 刷新 button only re-reads the list.
        void loadDistros(true);
        void loadAccessPaths();
      }, []);

      const check = async (distro) => {
        setNotice(null);
        setChecks((previous) => ({ ...previous, [distro]: { phase: "checking" } }));
        try {
          const answer = await statusRequest(`?distro=${encodeURIComponent(distro)}&refresh=1`);
          setChecks((previous) => ({ ...previous, [distro]: { phase: "done", ...answer } }));
        } catch (error) {
          setChecks((previous) => ({ ...previous, [distro]: { phase: "error", error: messageOf(error) } }));
        }
      };

      /**
       * Run the full doctor with `--fix-owned`: the row labels it `修复` when a
       * repairable finding exists and `完整检查` otherwise, but it is the same
       * run. Only the plugin's own state is touched.
       * @param distro - the distro to run against.
       */
      const repair = async (distro, mode = "repair") => {
        setNotice(null);
        setChecks((previous) => ({ ...previous, [distro]: { ...previous[distro], phase: "repairing", mode } }));
        try {
          const answer = await statusRequest(`?distro=${encodeURIComponent(distro)}`, "POST");
          setChecks((previous) => ({ ...previous, [distro]: { phase: "done", ...answer } }));
          const rows = Array.isArray(answer.repairs) ? answer.repairs : [];
          const fixed = rows.filter((row) => row.status === "ok").length;
          const remaining = (Array.isArray(answer.failures) ? answer.failures.length : 0)
            + (Array.isArray(answer.warnings) ? answer.warnings.length : 0);
          setNotice({
            kind: fixed > 0 || remaining === 0 ? "ok" : "info",
            text: fixed > 0 && remaining > 0
              ? `已在 ${distro} 修复 ${String(fixed)} 项；仍有 ${String(remaining)} 项需按下方处理办法手动处理。`
              : fixed > 0
                ? `已在 ${distro} 修复 ${String(fixed)} 项；复检通过。`
                : rows.length > 0
                  ? `尝试修复 ${String(rows.length)} 项但未通过复检；请按下方处理办法手动处理。`
                  : remaining > 0
                    ? `完整检查完成；没有可自动修复项，${String(remaining)} 项需按下方处理办法手动处理。`
                    : `已在 ${distro} 完成完整检查，未发现待修项。`,
          });
        } catch (error) {
          setChecks((previous) => ({ ...previous, [distro]: { ...previous[distro], phase: "error", error: messageOf(error) } }));
        }
      };

      return h(
        "div",
        { style: styles.panel },
        h(
          "div",
          { style: styles.inner },
          h(
            "header",
            null,
            h("div", { style: styles.title }, "WSL 环境"),
            h("div", { style: styles.subtitle }, "诊断与安全修复：已安装的发行版、快速检查，以及插件自有状态的修复。"),
          ),
          notice === null ? null : h("div", { style: notice.kind === "ok" ? styles.noticeOk : notice.kind === "info" ? styles.noticeInfo : styles.notice }, notice.text),
          h(
            Card,
            {
              title: "发行版与环境状态",
              actions: h(Btn, {
                label: "刷新",
                small: true,
                onClick: () => { void loadDistros(false); void loadAccessPaths(); },
              }),
            },
            h(
              "div",
              { style: styles.hint },
              "“检查”运行一次 doctor 的快速检查（与 /wsl-doctor 同源）：验证该发行版的 bwrap、systemd 与 Linger 等前置项。右侧按钮按结果切换：存在可自动修复项时显示“修复”，只修复插件自有状态（残留 session scope、损坏的 agent 缓存）并复检、显示 before→after；否则显示“完整检查”，运行完整 doctor 以发现更多项。自动修复不安装软件包、不改写 Windows 配置；其余告警按各自处理办法手动处理。手动检查/修复会让停止的发行版启动，所以只在点击时执行；页面加载的后台复核只针对正在运行的发行版，失败会按实际观测覆盖并标为“后台”来源。",
            ),
            phase === "loading"
              ? h("div", { style: styles.empty }, "加载中…")
              : phase === "error"
                ? h("div", { style: styles.empty }, "状态接口不可用（需要 Web 连接）。")
                : distros.length === 0
                  ? h("div", { style: styles.empty }, "没有发现发行版。")
                  : distros.map((distro) => {
                    const state = checks[distro];
                    const done = state !== undefined && state.phase === "done";
                    const checking = state !== undefined && state.phase === "checking";
                    const repairing = state !== undefined && state.phase === "repairing";
                    const refreshing = state !== undefined && state.phase === "refreshing";
                    const busy = checking || repairing || refreshing;
                    const repairable = Array.isArray(state?.repairable) ? state.repairable : [];
                    const canRepair = done && repairable.length > 0;
                    const findings = done
                      ? (Array.isArray(state.failures) ? state.failures.length : 0)
                        + (Array.isArray(state.warnings) ? state.warnings.length : 0)
                      : 0;
                    return h(
                      "div",
                      { key: distro, style: styles.row },
                      h(
                        "div",
                        { style: styles.rowHead },
                        h("span", { style: styles.rowName, title: distro }, distro),
                        h(CheckPill, { state }),
                        h(Btn, {
                          label: checking ? "检查中…" : refreshing ? "后台检查中…" : done ? "重新检查" : "检查",
                          small: true,
                          primary: state === undefined,
                          disabled: busy,
                          onClick: () => { void check(distro); },
                        }),
                        done || repairing
                          ? h(Btn, {
                            label: repairing ? (state?.mode === "full" ? "完整检查中…" : "修复中…") : canRepair ? "修复" : "完整检查",
                            small: true,
                            disabled: busy,
                            onClick: () => { void repair(distro, canRepair ? "repair" : "full"); },
                          })
                          : null,
                      ),
                      state === undefined
                        ? h("div", { style: styles.hint }, "尚未检查：点击“检查”运行快速 doctor（约 10 秒；会启动停止的发行版）。")
                        : state.phase === "checking"
                          ? h("div", { style: styles.hint }, "正在运行快速检查…（会启动停止的发行版）")
                          : state.phase === "repairing"
                            ? h("div", { style: styles.hint }, state?.mode === "full"
                              ? "正在运行完整检查（按上次结果没有可自动修复项）…"
                              : "正在运行完整检查并修复插件自有状态…")
                            : state.phase === "error"
                              ? h("div", { style: styles.detail }, h("span", { style: styles.failure }, state.error))
                              : h(
                                "div",
                                { style: styles.detail },
                                h(ResultSummary, { state }),
                                state.verdict === "error"
                                  ? h("span", { style: styles.failure }, state.error ?? "检查未能完成")
                                  : null,
                                h(RepairList, { items: state.repairs }),
                                h(IssueList, {
                                  heading: `待修项（${String(Array.isArray(state.failures) ? state.failures.length : 0)}）`,
                                  items: state.failures,
                                  severity: "fail",
                                  repairable,
                                }),
                                h(IssueList, {
                                  heading: `告警（${String(Array.isArray(state.warnings) ? state.warnings.length : 0)}）`,
                                  items: state.warnings,
                                  severity: "warn",
                                  repairable,
                                }),
                                findings > 0
                                  ? h("div", { style: styles.hint }, canRepair
                                    ? "标有“可自动修复”的项会由“修复”处理；其余项目需按处理办法手动处理。"
                                    : "以上项目没有可自动修复项，需按各自处理办法手动处理。自动修复只覆盖残留 session scope 与损坏的 agent 缓存。")
                                  : null,
                                h(CheckDetails, { state }),
                              ),
                    );
                  }),
          ),
          // The audit half of the reminder: the directories whose sessions keep
          // the host preset. The composer banner is the moment-of-use warning;
          // this list is how the choice stays visible after it is collapsed.
          h(
            Card,
            { title: "Windows 访问工作区" },
            accessPaths === null
              ? h("div", { style: styles.empty }, "加载中…")
              : accessPaths.length === 0
                ? h("div", { style: styles.empty }, "没有以 Windows 访问方式打开的发行版目录。")
                : accessPaths.map((path) => h(
                  "div",
                  { key: path, style: styles.row },
                  h(
                    "div",
                    { style: styles.rowHead },
                    h("span", { style: styles.rowName, title: path }, path),
                  ),
                )),
            h(
              "div",
              { style: styles.hint },
              "这些发行版目录按 Windows 共享（9p）打开：其中的会话保留宿主 preset，命令走 PowerShell，没有 Linux 工具链；会话内的常驻警示条可一键切回 WSL 模式。此列表存放在 auto-preset 的 windowsWorkspaces 中，也可在设置里修改。",
            ),
          ),
        ),
      );
    }

    // ── The access-mode prompt ─────────────────────────────────────────────

    /** One pending prompt, shared by the watcher and the overlay occupant. */
    const accessPrompt = {
      value: null,
      listeners: new Set(),
      get() { return accessPrompt.value; },
      set(next) {
        accessPrompt.value = next;
        for (const listener of accessPrompt.listeners) listener();
      },
      subscribe(listener) {
        accessPrompt.listeners.add(listener);
        return () => { accessPrompt.listeners.delete(listener); };
      },
    };

    /**
     * The modal that asks how a newly added distro workspace is opened.
     * @param props - the client root context.
     * @returns the modal, or null while nothing is pending.
     */
    function AccessPrompt({ ctx }) {
      const [request, setRequest] = useState(accessPrompt.get());
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);

      useEffect(() => accessPrompt.subscribe(() => {
        setRequest(accessPrompt.get());
        setError(null);
        setBusy(false);
      }), []);

      // Dismissing the prompt takes the default: Remote WSL. Nothing is written,
      // which is exactly what "keep the default" means for this record.
      useEffect(() => {
        if (request === null) return undefined;
        const onKey = (event) => { if (event.key === "Escape") accessPrompt.set(null); };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
      }, [request]);

      if (request === null) return null;

      const close = () => { accessPrompt.set(null); };

      const chooseWindows = async () => {
        setBusy(true);
        setError(null);
        try {
          const current = await readAccess(ctx);
          const paths = current.ok === true ? current.paths : [];
          if (current.ok !== true) throw new Error(current.message);
          const next = paths.some((entry) => samePath(entry, request.path))
            ? paths
            : [...paths, request.path];
          const failure = await writeAccess(ctx, next);
          if (failure !== undefined) throw new Error(failure);
          const switchFailure = await switchWorkspaceSessions(ctx, request.workspaceId);
          if (switchFailure !== undefined) throw new Error(switchFailure);
          accessPrompt.set(null);
        } catch (reason) {
          setError(messageOf(reason));
        } finally {
          setBusy(false);
        }
      };

      return h(
        "div",
        {
          onClick: (event) => { if (event.target === event.currentTarget) close(); },
          style: {
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            pointerEvents: "auto",
            background: "rgba(0, 0, 0, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          },
        },
        h(
          "div",
          {
            role: "dialog",
            "aria-modal": "true",
            "aria-label": "选择 WSL 工作区的打开方式",
            style: {
              width: 480,
              maxWidth: "100%",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: "18px 20px 16px",
              borderRadius: 12,
              background: "var(--dsh-bg, #1f1f1f)",
              color: "inherit",
              border: "1px solid rgba(128, 128, 128, 0.35)",
              boxShadow: "0 16px 48px rgba(0, 0, 0, 0.5)",
              fontSize: 13,
            },
          },
          h("div", { style: { fontSize: 15, fontWeight: 600 } }, "这个文件夹在 WSL 发行版内"),
          h("div", { style: { fontSize: 12, opacity: 0.6, wordBreak: "break-all" } }, request.path),
          h(
            "div",
            { style: { fontSize: 12.5, opacity: 0.85 } },
            "选择打开方式。默认 Remote WSL：命令、文件与终端都在发行版内运行。",
          ),
          error === null ? null : h("div", { style: styles.notice }, error),
          h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: 8, marginTop: 4 } },
            h(Btn, {
              label: "Remote WSL（推荐）",
              primary: true,
              disabled: busy,
              onClick: close,
            }),
            h(Btn, {
              label: "Windows 访问（经 9p 共享）",
              disabled: busy,
              onClick: () => { void chooseWindows(); },
            }),
          ),
          h(
            "div",
            { style: { fontSize: 11.5, opacity: 0.5 } },
            "Windows 访问把该文件夹当作普通 Windows 共享打开：不启用发行版执行环境，读写经过 9p，较慢，但适合只想用 Windows 工具链的场景。选择会记录到插件配置，之后在该工作区新建的会话同样生效。",
          ),
        ),
      );
    }

    /**
     * Watch for newly added WSL workspaces and raise the access-mode prompt.
     * Existing workspaces are the baseline: startup restoration must not ask
     * again for a workspace the operator already opened.
     * @param ctx - client root context.
     * @returns a disposer owned by the plugin fiber.
     */
    const watchWorkspaces = (ctx) => {
      const workspaces = service(ctx, "workspaces");
      if (workspaces === undefined) return undefined;
      let known;
      const consider = () => {
        const snapshot = workspaces.list.getSnapshot();
        if (snapshot.phase !== "ready" || !Array.isArray(snapshot.items)) return;
        const ids = new Set(snapshot.items.map((item) => item.workspaceId));
        if (known === undefined) {
          known = ids;
          return;
        }
        for (const item of snapshot.items) {
          if (known.has(item.workspaceId)) continue;
          if (!isWslUnc(item.path)) continue;
          accessPrompt.set({ workspaceId: item.workspaceId, path: item.path });
          break;
        }
        known = ids;
      };
      consider();
      return workspaces.list.subscribe(consider);
    };

    return {
      inject: ["slots"],
      apply(ctx) {
        // Sidebar panel: icon in the navigation column, page in the main seat.
        ctx.slots.inject("sidebar.panellist", function* () {
          yield ctx.slots.register(
            {
              name: "sidebar.panellist",
              id: PANEL_ID,
              order: PANEL_ORDER,
              label: "WSL 环境",
            },
            ({ size, active }) => h(WslIcon, { size, active }),
          );
        });
        ctx.slots.inject("main", function* () {
          yield ctx.slots.register(
            { name: "main", key: PANEL_ID },
            () => h(WslPanel, { ctx }),
          );
        });
        // The host-mode reminder rides the composer dock (a list slot above the
        // composer, alongside the shipped queue/todo/goal docks), so it is
        // visible for the whole conversation without shadowing shipped UI; the
        // session header keeps a quiet badge after it is collapsed.
        ctx.slots.inject("conversation.input.dock", function* () {
          yield ctx.slots.register(
            { name: "conversation.input.dock", id: "wsl-env.access-mode", order: 90 },
            (props) => h(AccessModeBanner, Object.assign({}, props, { ctx })),
          );
        });
        ctx.slots.inject("conversation.session.header.utilities", function* () {
          yield ctx.slots.register(
            { name: "conversation.session.header.utilities", id: "wsl-env.access-mode-badge", order: 90 },
            (props) => h(AccessModeBadge, Object.assign({}, props, { ctx })),
          );
        });
        // The post-add prompt rides the frame-wide overlay seat.
        ctx.slots.inject("shell.overlay", function* () {
          yield ctx.slots.register(
            { name: "shell.overlay", id: "wsl-access-choice", order: 100 },
            () => h(AccessPrompt, { ctx }),
          );
        });
        // Session-header menu: open a distro workspace in VS Code through
        // Remote-WSL. The shipped "Open in app" item launches the same editor,
        // but a WSL UNC workspace opens there as a plain 9p folder; this route
        // builds the `vscode-remote` URI instead. The Host row also clears
        // ELECTRON_RUN_AS_NODE, so the shipped item stops failing.
        ctx.inject(["contextMenus", "sessions"], (scope) => {
          scope.effect(() => scope.contextMenus.register({
            id: "wsl-env.openInVSCode",
            target: "sessionHeader",
            order: 505,
            observe: () => [scope.sessions.list],
            resolve: ({ sessionId }) => {
              const snapshot = scope.sessions.list.getSnapshot();
              const cwd = snapshot && snapshot.byId ? snapshot.byId[sessionId]?.cwd : undefined;
              if (!isWslUnc(cwd)) return [];
              return [{
                id: "vscode",
                label: "在 VS Code 中打开（WSL）",
                failureLabel: "在 VS Code 中打开失败",
                run: async () => {
                  const answer = await fetch(OPEN_IN_APP_PATH, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ path: cwd }),
                  });
                  const body = await answer.json().catch(() => ({}));
                  if (!answer.ok) throw new Error(body.error ?? ("打开失败（HTTP " + answer.status + "）"));
                },
              }];
            },
          }), "wsl-env: open workspace in VS Code");
        });
        // The workspace catalog activates independently of this module; the
        // prompt watcher waits for it instead of sampling a missing service.
        ctx.inject(["workspaces"], (scope) => {
          scope.effect(() => {
            const stop = watchWorkspaces(scope);
            return () => { if (typeof stop === "function") stop(); };
          }, "wsl-env: workspace access prompt");
        });
      },
    };
  },
});
