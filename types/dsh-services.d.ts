/**
 * Loads the `@deepseek-ai/*` packages' `declare module '@deepseek-ai/cordis'`
 * augmentations, so `ctx.fs`, `ctx.shell`, `ctx.subprocess`, `ctx.sandbox`,
 * `ctx.sandboxPolicy`, `ctx.directoryPicker` and friends are typed on the
 * context for the whole program.
 *
 * A `checkJs` program only sees a package's augmentation when something
 * imports that package; the runtime composition loads most of these services
 * from other plugins' rows, so nothing in `lib/` imports them directly. This
 * file exists purely to pull the declarations in — it ships nowhere
 * (`package.json` `files` does not list it) and declares nothing itself.
 *
 * The `-local` implementation packages intentionally augment nothing: the
 * augmentations live on the abstract service packages their base classes
 * come from.
 *
 * @module check-only
 */

/// <reference types="@deepseek-ai/dsh-fs" />
/// <reference types="@deepseek-ai/dsh-subprocess" />
/// <reference types="@deepseek-ai/dsh-sandbox" />
/// <reference types="@deepseek-ai/dsh-sandbox-policy" />
/// <reference types="@deepseek-ai/dsh-host-directory-picker" />
/// <reference types="@deepseek-ai/dsh-api-workspace-files" />
/// <reference types="@deepseek-ai/dsh-typert-protocol" />
