/**
 * The doctor's GUI button: a pill in the conversation composer dock that drops
 * `/wsl-doctor` into the current session's input and submits it.
 *
 * The composer dock's slot components receive the harness's standard props —
 * `inputActions` among them. Sending is `setDraft(text)` (replace the whole
 * draft with plain text) followed by `submit()` (send the current draft — the
 * published face has no submit-with-text verb). When those verbs are missing
 * the button degrades to a draft prefill, never to a broken control.
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

    const COMMAND =
      "请用 wsl_doctor 工具对当前会话的发行版运行环境诊断：先给 verdict，" +
      "blocked 时逐条列出失败项与 remedy，不代改文件、不代装软件包。";

    function DoctorButton(props) {
      const trigger = () => {
        const actions = props && props.inputActions;
        // The published InputActions face has no submit(text): submit() sends
        // the CURRENT draft, and insertText needs a captureInsertion() span.
        // setDraft replaces the whole draft with plain text, then submit()
        // sends it — one click, no span bookkeeping.
        if (actions && typeof actions.setDraft === "function" && typeof actions.submit === "function") {
          try {
            actions.setDraft(COMMAND);
            actions.submit();
            return;
          } catch (error) {
            // Fall through to the draft prefill below; the command text is the
            // same either way.
          }
        }
        if (actions && typeof actions.setDraft === "function") {
          try {
            actions.setDraft(COMMAND);
            return;
          } catch (error) {
            // Ignored: the draft stays untouched rather than half-filled.
          }
        }
      };
      return h(
        "button",
        {
          type: "button",
          onClick: trigger,
          title: "运行 WSL 环境诊断（doctor）",
          style: {
            display: "flex",
            alignItems: "center",
            gap: 5,
            // The dock is a centered flex row; an auto left margin overrides
            // the group centering for this item alone and pins the pill to
            // the dock's right edge.
            marginLeft: "auto",
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
        "WSL 诊断"
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
