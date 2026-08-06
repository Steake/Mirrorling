/**
 * Optional production-client helper. No server change is required.
 * Call readOverlayHandoff("bench_state") as early as your production app needs.
 */
export function readOverlayHandoff(parameter = "bench_state") {
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get(parameter);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const fromFragment = fragment.get(parameter);

  let fromWindowName = null;
  try {
    const named = JSON.parse(window.name || "{}");
    fromWindowName = named?.[parameter] ?? null;
    if (fromWindowName) {
      delete named[parameter];
      window.name = Object.keys(named).length ? JSON.stringify(named) : "";
    }
  } catch {
    window.name = "";
  }

  const serialized = fromQuery ?? fromFragment;
  if (serialized) {
    try {
      return JSON.parse(serialized);
    } catch {
      return null;
    }
  }
  return fromWindowName;
}
