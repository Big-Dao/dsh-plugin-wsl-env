/**
 * The doctor's GUI button: a pill in the conversation composer dock that drops
 * `/wsl-doctor` into the current session's input and submits it.
 *
 * The composer dock's slot components receive the harness's standard props —
 * `inputActions` among them (insert/insertQuote and the submit verb over the
 * per-session input facade). Submission is feature-detected: when the runtime
 * exposes a submit verb it fires directly (one click); otherwise the command
 * text lands in the draft for the user to send with Enter — the button then
 * degrades to a prefill, never to a broken control.
 *
 * Loaded by the harness's web client loader through the `dsh.client`
 * declaration in package.json; the shape mirrors the working
 * `composer-badge` local bundle.
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
        if (actions && typeof actions.submit === "function") {
          try {
            actions.submit(COMMAND);
            return;
          } catch (error) {
            // Fall through to the draft prefill below; the command text is the
            // same either way.
          }
        }
        if (actions && typeof actions.insertText === "function") {
          try {
            actions.insertText(COMMAND);
            return;
          } catch (error) {
            // Ignored: the draft stays untouched rather than half-filled.
          }
        } else if (actions && typeof actions.insertQuote === "function") {
          try {
            actions.insertQuote(COMMAND);
            return;
          } catch (error) {
            // Ignored, same shape as insertText.
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
            padding: "2px 10px",
            borderRadius: 999,
            fontSize: 12,
            border: "1px solid currentColor",
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
