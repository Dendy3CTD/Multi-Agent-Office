export type StartupMode = "tower" | "showroom" | "legacy";

export function isLegacyRoute(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has("legacy") || params.has("video") || (params.has("sim") && !params.has("world"));
}

export function startupMode(search: string): StartupMode {
  if (isLegacyRoute(search)) return "legacy";
  return new URLSearchParams(search).has("showroom") ? "showroom" : "tower";
}
