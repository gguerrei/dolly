/**
 * The native shell's pickers, when there is a native shell. Tauri injects
 * `window.__TAURI__` into the page the daemon serves (the capability in
 * `src-tauri/capabilities/default.json` names that origin); in a plain
 * browser it is absent and every view keeps its typed path. Nothing else
 * ever crosses this seam: the engine is still only reachable through the
 * daemon.
 */

interface DialogFilter {
  name: string;
  extensions: string[];
}

interface TauriDialog {
  open(options: {
    title?: string;
    directory?: boolean;
    multiple?: false;
    filters?: DialogFilter[];
  }): Promise<string | null>;
  save(options: {
    title?: string;
    defaultPath?: string;
    filters?: DialogFilter[];
  }): Promise<string | null>;
}

const dialog = (window as { __TAURI__?: { dialog?: TauriDialog } }).__TAURI__?.dialog;

/** True inside the native shell, where Browse buttons make sense. */
export const hasPickers = dialog !== undefined;

/** A directory, or null when the person cancelled. */
export function pickDirectory(title: string): Promise<string | null> {
  return dialog ? dialog.open({ title, directory: true, multiple: false }) : Promise.resolve(null);
}

/** A `.dolly` bundle to import, or null. */
export function pickBundle(): Promise<string | null> {
  return dialog
    ? dialog.open({
        title: "Import a .dolly bundle",
        multiple: false,
        filters: [{ name: "dolly bundle", extensions: ["dolly"] }],
      })
    : Promise.resolve(null);
}

/** Where to write a bundle, or null. */
export function pickBundleTarget(name: string): Promise<string | null> {
  return dialog
    ? dialog.save({
        title: "Save the bundle",
        defaultPath: `${name}.dolly`,
        filters: [{ name: "dolly bundle", extensions: ["dolly"] }],
      })
    : Promise.resolve(null);
}
