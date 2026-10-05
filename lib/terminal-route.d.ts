/**
 * @param {string|undefined} cwd - the terminal request's working directory, any coordinate system.
 * @returns {"distro"|"host"} `"distro"` when the launch belongs inside the pinned distro,
 *   `"host"` when it belongs to a Windows-folder session.
 */
export function terminalRoute(cwd: string | undefined): "distro" | "host";
