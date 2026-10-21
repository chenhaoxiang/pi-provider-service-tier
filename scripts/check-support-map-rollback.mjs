import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Validate the file that the TARGET package would read; never overwrite or reverse-migrate it. */
export function checkSupportMapRollback(file, maxSchema) {
  if (!Number.isInteger(maxSchema) || maxSchema < 1 || maxSchema > 3) throw new Error("Target support-map schema must be 1, 2 or 3");
  let contents;
  try { contents = readFileSync(file, "utf8"); }
  catch (error) { if (error?.code === "ENOENT") return { compatible: true, version: null, maxSchema }; throw new Error("Support-map rollback check could not read the target file"); }
  let map;
  try { map = JSON.parse(contents); } catch { throw new Error("Support-map rollback refused: target file is not valid JSON"); }
  const version = map && typeof map === "object" && !Array.isArray(map) ? map.version ?? 1 : undefined;
  if (!Number.isInteger(version) || version < 1 || version > maxSchema) {
    throw new Error("Support-map rollback refused: target package cannot safely read this schema. Preserve the current files and use a matching reviewed backup in a coordinated idle window; no state was changed.");
  }
  return { compatible: true, version, maxSchema };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(checkSupportMapRollback(process.argv[2], Number(process.argv[3])))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
