/**
 * The doctor's GUI button: a pill in the conversation composer dock that opens
 * a small menu of wsl_doctor run modes — two depths (quick, full) and the
 * six single-section scopes. Picking an entry drops the matching `/wsl-doctor`
 * command into the current session's input and submits it; the commands
 * registry executes it host-side and the report renders in the UI without a
 * model turn.
 *
 * The composer dock's slot components receive the harness's standard props —
 * `inputActions` among them. Sending is `setDraft(text)` (replace the whole
 * draft with plain text) followed by `submit()` (send the current draft — the
 * published face has no submit-with-text verb). When those verbs are missing
 * the menu degrades to a draft prefill, never to a broken control.
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
    const useEffect = React.useEffect;
    const useState = React.useState;

    // The command plane, not the model: each entry drops a `/wsl-doctor` line.
    // Slash commands execute in the UI command plane against the commands
    // registry (`dsh-commands` contract) — the handler spawns the standalone
    // doctor CLI and the settled report renders detached from model history,
    // adding no tokens. A deployment without the command adapter rejects the
    // line at the composer instead of sending a prompt.
    const commandFor = (mode) => {
      if (mode.kind === "quick") return "/wsl-doctor quick";
      if (mode.kind === "full") return "/wsl-doctor full";
      return "/wsl-doctor " + mode.section;
    };

    // Menu layout: two depth entries, then the section scopes the wsl_doctor
    // tool accepts. Labels mirror the tool's own depth/section vocabulary.
    const MENU = [
      { header: "诊断深度" },
      { label: "快速诊断（推荐）", hint: "仅前置项，约 10 秒", mode: { kind: "quick" } },
      { label: "完整诊断", hint: "全部检查项含 agent 冒烟", mode: { kind: "full" } },
      { header: "分区诊断" },
      { label: "host", mode: { kind: "section", section: "host" } },
      { label: "sandbox", mode: { kind: "section", section: "sandbox" } },
      { label: "session", mode: { kind: "section", section: "session" } },
      { label: "conf", mode: { kind: "section", section: "conf" } },
      { label: "net", mode: { kind: "section", section: "net" } },
      { label: "agent", mode: { kind: "section", section: "agent" } },
    ];

    function DoctorButton(props) {
      const [open, setOpen] = useState(false);
      const [root, setRoot] = useState(null);

      // Close on any outside click; the root node ref keeps the listener's
      // contains() check exact without querying the DOM.
      useEffect(() => {
        if (!open || !root) return undefined;
        const close = (event) => {
          if (root && !root.contains(event.target)) setOpen(false);
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
      }, [open, root]);

      const send = (mode) => {
        setOpen(false);
        const command = commandFor(mode);
        const actions = props && props.inputActions;
        // The published InputActions face has no submit(text): submit() sends
        // the CURRENT draft, and insertText needs a captureInsertion() span.
        // setDraft replaces the whole draft with plain text, then submit()
        // sends it — one click, no span bookkeeping.
        if (actions && typeof actions.setDraft === "function" && typeof actions.submit === "function") {
          try {
            actions.setDraft(command);
            actions.submit();
            return;
          } catch (error) {
            // Fall through to the draft prefill below; the command text is the
            // same either way.
          }
        }
        if (actions && typeof actions.setDraft === "function") {
          try {
            actions.setDraft(command);
            return;
          } catch (error) {
            // Ignored: the draft stays untouched rather than half-filled.
          }
        }
      };

      const menu = open
        ? h(
            "div",
            {
              // Anchored above the pill; the dock sits at the composer's
              // bottom edge, so the menu opens upward.
              style: {
                position: "absolute",
                bottom: "calc(100% + 6px)",
                right: 0,
                minWidth: 220,
                padding: "4px 0",
                borderRadius: 8,
                background: "var(--dsh-bg, #1f1f1f)",
                color: "inherit",
                boxShadow: "0 4px 16px rgba(0, 0, 0, 0.35)",
                border: "1px solid rgba(128, 128, 128, 0.35)",
                zIndex: 50,
                fontSize: 12,
              },
            },
            MENU.map((entry, index) => {
              if (entry.header) {
                return h(
                  "div",
                  {
                    key: "header-" + entry.header,
                    style: {
                      padding: "5px 12px 3px",
                      opacity: 0.55,
                      fontSize: 11,
                      userSelect: "none",
                    },
                  },
                  entry.header
                );
              }
              return h(
                "div",
                {
                  key: "item-" + String(index),
                  onClick: () => send(entry.mode),
                  style: {
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "6px 12px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  },
                  onMouseEnter: (event) => {
                    event.currentTarget.style.background = "rgba(128, 128, 128, 0.2)";
                  },
                  onMouseLeave: (event) => {
                    event.currentTarget.style.background = "transparent";
                  },
                },
                h("span", null, entry.label),
                entry.hint
                  ? h("span", { style: { opacity: 0.55, fontSize: 11 } }, entry.hint)
                  : null
              );
            })
          )
        : null;

      return h(
        "div",
        {
          ref: setRoot,
          // The dock is a centered flex row; an auto left margin overrides the
          // group centering for this item alone and pins the pill to the
          // dock's right edge.
          style: { position: "relative", marginLeft: "auto" },
        },
        menu,
        h(
          "button",
          {
            type: "button",
            onClick: () => setOpen(!open),
            title: "运行 WSL 环境诊断（doctor）：选择诊断模式",
            style: {
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "2px 10px",
              borderRadius: 999,
              fontSize: 12,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "inherit",
              opacity: 0.75,
              cursor: "pointer",
              userSelect: "none",
            },
          },
          "WSL 诊断",
          h("span", { style: { fontSize: 9, opacity: 0.8 } }, open ? "▲" : "▼")
        )
      );
    }

    return {
      inject: ["slots"],
      apply(ctx) {
        ctx.slots.inject("conversation.composer.dock", function* () {
          yield ctx.slots.register(
            {
              name: "conversation.composer.dock",
              id: "wsl-doctor-button",
              order: 9,
            },
            DoctorButton
          );
        });
      },
    };
  },
});
