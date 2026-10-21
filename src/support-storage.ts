import { randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_MAP, MapFileError, ensureMap, readMap, type ServiceTierMapFile } from "./support-map.ts";

export const SUPPORT_MAP_BASENAME = "pi-provider-service-tier-map-v3.json";
export const LEGACY_SUPPORT_MAP_BASENAME = "pi-provider-service-tier-map.json";

/** A schema generation owns its file. Old processes may keep writing the legacy file. */
export function ensureSupportStorage(paths: { map: string; legacyMap?: string }): ServiceTierMapFile {
  if (!paths.legacyMap) return ensureMap(paths.map);
  if (existsSync(paths.map)) {
    try {
      if (existsSync(paths.legacyMap)) {
        const current = statSync(paths.map); const legacy = statSync(paths.legacyMap);
        if (realpathSync(paths.map) === realpathSync(paths.legacyMap) || current.dev === legacy.dev && current.ino === legacy.ino) {
          throw new MapFileError(paths.map, "changed");
        }
      }
      return ensureMap(paths.map);
    } catch (error) {
      if (error instanceof MapFileError) throw error;
      throw new MapFileError(paths.map, "read");
    }
  }
  // Import once, without modifying the source or importing it again on later old-session writes.
  const initial = readMap(paths.legacyMap) ?? { ...DEFAULT_MAP, entries: {} };
  const temporary = join(dirname(paths.map), `.service-tier-import-${randomUUID()}.tmp`);
  try {
    mkdirSync(dirname(paths.map), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify(initial, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    try { linkSync(temporary, paths.map); }
    catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
        throw new MapFileError(paths.map, "write");
      }
    }
  } catch (error) {
    if (error instanceof MapFileError) throw error;
    throw new MapFileError(paths.map, "write");
  } finally { try { rmSync(temporary, { force: true }); } catch { /* Do not mask the original map failure. */ } }
  return ensureMap(paths.map);
}
