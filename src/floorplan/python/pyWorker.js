/* Python-object worker: runs a Python object's generator with Pyodide, off the UI thread.
 *
 * Message in : { id, key, source, entry, params }
 * Message out: { id, ok: true, meshes: [{name, color, material, positions: Float32Array, indices: Uint32Array}], plan, stats }
 *            | { id, ok: false, error }
 *
 * Each distinct `source` is executed ONCE into its own namespace (keyed by the caller's `key`), so repeat calls
 * with new params only pay for `entry(params)`. Pyodide itself loads lazily on the first message. */
/* global loadPyodide, importScripts */
const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
let pyReady = null;
const namespaces = new Map();

function ensurePyodide() {
  if (!pyReady) {
    importScripts(`${PYODIDE_URL}pyodide.js`);
    pyReady = loadPyodide({ indexURL: PYODIDE_URL });
  }
  return pyReady;
}

self.onmessage = async (e) => {
  const { id, key, source, entry, params } = e.data;
  try {
    const py = await ensurePyodide();
    let ns = namespaces.get(key);
    if (!ns) {
      ns = py.globals.get("dict")();
      py.runPython(source, { globals: ns });
      namespaces.set(key, ns);
    }
    const fn = ns.get(entry || "build");
    if (!fn) throw new Error(`entry "${entry}" is not defined by the object's Python source`);
    const pyParams = py.toPy(params || {});
    const t0 = performance.now();
    const res = fn(pyParams);
    pyParams.destroy();
    const js = res.toJs({ dict_converter: Object.fromEntries });
    res.destroy();
    const transfers = [];
    const meshes = (js.meshes || []).map((m) => {
      const positions = Float32Array.from(m.positions || []);
      const indices = Uint32Array.from(m.indices || []);
      transfers.push(positions.buffer, indices.buffer);
      return { name: m.name, color: m.color, material: m.material, positions, indices };
    });
    self.postMessage({ id, ok: true, meshes, plan: js.plan || [], stats: { ...(js.stats || {}), ms: Math.round(performance.now() - t0) } }, transfers);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
