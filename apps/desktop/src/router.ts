import { ref } from "vue";

/** Seven views behind a hash, all the routing dolly needs (docs/design/gui.md). */
export type Route =
  | { view: "library" }
  | { view: "pattern"; name: string }
  | { view: "check" }
  | { view: "fit" }
  | { view: "learn" }
  | { view: "export"; name?: string }
  | { view: "settings" };

function parse(hash: string): Route {
  const path = hash.replace(/^#/, "");
  try {
    return parseRoute(path);
  } catch {
    return { view: "library" }; // a malformed escape in the hash is nowhere, not a blank tab
  }
}

function parseRoute(path: string): Route {
  const pattern = path.match(/^\/pattern\/(.+)$/);
  if (pattern) return { view: "pattern", name: decodeURIComponent(pattern[1] ?? "") };
  if (path === "/check") return { view: "check" };
  if (path === "/fit") return { view: "fit" };
  if (path === "/learn") return { view: "learn" };
  const exported = path.match(/^\/export(?:\/(.+))?$/);
  if (exported) {
    return exported[1]
      ? { view: "export", name: decodeURIComponent(exported[1]) }
      : { view: "export" };
  }
  if (path === "/settings") return { view: "settings" };
  return { view: "library" };
}

export const route = ref<Route>(parse(location.hash));

window.addEventListener("hashchange", () => {
  route.value = parse(location.hash);
});
