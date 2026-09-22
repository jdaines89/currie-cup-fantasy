import { ApiSportsProvider } from "./apisports";
import { TheSportsDbProvider } from "./thesportsdb";
import type { DataProvider } from "./types";

export type { DataProvider, ProviderMatch, ProviderTeam } from "./types";

export function getProvider(name = process.env.DATA_PROVIDER ?? "thesportsdb"): DataProvider {
  switch (name) {
    case "thesportsdb": return new TheSportsDbProvider();
    case "apisports":   return new ApiSportsProvider();
    default: throw new Error(`Unknown DATA_PROVIDER "${name}". Use "thesportsdb" or "apisports".`);
  }
}
