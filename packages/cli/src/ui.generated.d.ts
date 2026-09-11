/**
 * The shape of the generated `ui.generated.ts` (packages/cli/scripts/embed-ui.ts):
 * the built webview's files by relative path, each resolved to where its
 * bytes live. A plain checkout has no such module; the daemon then serves
 * apps/desktop/dist from disk.
 */
declare const files: Record<string, string>;
export default files;
