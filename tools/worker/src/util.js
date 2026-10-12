export const err = (status, message) => Object.assign(new Error(message), { status });
export const json = (o, status = 200, headers = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });
export const stripQuotes = (s) => s.replace(/^W\//, "").replace(/^"|"$/g, "");

/** A library-relative path: no leading slash or "library/", no "."/".." segments, nothing under "_" folders. */
export function cleanPath(p) {
  if (!p) throw err(400, "missing ?path=");
  const s = String(p).replace(/^\/+/, "").replace(/^library\//, "");
  if (s.split("/").some((seg) => seg === ".." || seg === "." || seg === "") || s.startsWith("_")) throw err(400, "bad path");
  return s;
}
