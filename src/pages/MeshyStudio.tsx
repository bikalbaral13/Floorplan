import { useState, useEffect, ReactNode, useRef } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { uploadImageToS3, getDataSpecificById, updateServiceByEntity, getServiceByEntity, postServiceByEntity } from "@/api/action";
import GlbViewer from "@/components/GlbViewer";

// ─── Types ────────────────────────────────────────────────────────────────────
interface MeshyTask {
  id?: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | string;
  progress?: number;
  model_urls?: Record<string, string>;
  thumbnail_urls?: string[];
  image_urls?: string[];
  error?: string;
  label?: string;
  // Metadata added when saving to backend
  _panelSource?: string;
  _savedAt?: string;
}

interface MeshyBalance {
  balance?: number;
  [key: string]: unknown;
}

interface TabConfig {
  id: string;
  label: string;
  icon: string;
}

interface PanelProps {
  apiKey: string;
  // Optional pre-fill from router state (when coming from ImageApiProcessor)
  initialTaskId?: string;
  initialImageUrl?: string;
  initialModelUrl?: string;
  // Called by panels when a Meshy task succeeds, so parent can persist to backend
  onTaskComplete?: (task: MeshyTask, panelId: string) => void;
}

interface BtnProps {
  children: ReactNode;
  onClick: () => void;
  loading?: boolean;
  variant?: "primary" | "secondary";
  className?: string;
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  rows?: number;
  allowUpload?: boolean;
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

interface ResultCardProps {
  task: MeshyTask | null;
  label?: string;
}

interface StatusBadgeProps {
  status: string;
}

interface ProgressRingProps {
  progress?: number;
}

// ─── Direct Meshy API Integration ───────────────────────────────────────────
const BASE_URL = "https://api.meshy.ai/openapi";

function getHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function meshyPost(apiKey: string, endpoint: string, body: object): Promise<any> {
  const finalurl = endpoint === "text-to-3d" ? `${BASE_URL}/v2/${endpoint}` : `${BASE_URL}/v1/${endpoint}`
  const res = await fetch(`${finalurl}`, {
    method: "POST",
    headers: getHeaders(apiKey),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Request failed: ${res.status}`);
  return data;
}

async function meshyGet(apiKey: string, endpoint: string): Promise<any> {
  const finalurl = endpoint === "text-to-3d" ? `${BASE_URL}/${endpoint}` : `${BASE_URL}/${endpoint}`
  console.log("text:", finalurl)
  const res = await fetch(`${finalurl}`, {
    headers: getHeaders(apiKey),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Request failed: ${res.status}`);
  return data;
}

async function pollTask(
  apiKey: string,
  endpoint: string,
  taskId: string,
  onProgress?: (task: MeshyTask) => void,
  maxWaitMs = 600000
): Promise<MeshyTask> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const task: MeshyTask = await meshyGet(apiKey, `${endpoint}/${taskId}`);
    onProgress?.(task);
    if (task.status === "SUCCEEDED") return task;
    if (task.status === "FAILED") throw new Error(`Task ${taskId} failed.`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Task polling timed out.");
}

// ─── Tab Config ──────────────────────────────────────────────────────────────
const TABS: TabConfig[] = [
  { id: "text-to-3d", label: "Text → 3D", icon: "⬡" },
  { id: "image-to-3d", label: "Image → 3D", icon: "◈" },
  { id: "text-to-image", label: "Text → Image", icon: "◉" },
  { id: "remesh", label: "Remesh", icon: "⬢" },
  { id: "retexture", label: "Retexture", icon: "◫" },
  { id: "rigging", label: "Rigging", icon: "⬟" },
  { id: "balance", label: "Balance", icon: "◎" },
];

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: StatusBadgeProps) {
  const cfgMap: Record<string, { bg: string; text: string; dot: string }> = {
    SUCCEEDED: { bg: "bg-emerald-500/20", text: "text-emerald-300", dot: "bg-emerald-400" },
    FAILED: { bg: "bg-red-500/20", text: "text-red-300", dot: "bg-red-400" },
    PENDING: { bg: "bg-amber-500/20", text: "text-amber-300", dot: "bg-amber-400 animate-pulse" },
    IN_PROGRESS: { bg: "bg-sky-500/20", text: "text-sky-300", dot: "bg-sky-400 animate-pulse" },
  };
  const cfg = cfgMap[status] ?? { bg: "bg-zinc-200 dark:bg-zinc-700", text: "text-zinc-700 dark:text-zinc-300", dot: "bg-zinc-400" };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-semibold ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {status}
    </span>
  );
}

// ─── Progress Ring ────────────────────────────────────────────────────────────
function ProgressRing({ progress = 0 }: ProgressRingProps) {
  const r = 28;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative w-16 h-16 flex items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" width="64" height="64">
        <circle cx="32" cy="32" r={r} stroke="#1e293b" strokeWidth="4" fill="none" />
        <circle
          cx="32" cy="32" r={r} stroke="#6366f1" strokeWidth="4" fill="none"
          strokeDasharray={c}
          strokeDashoffset={c - (c * progress) / 100}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
      </svg>
      <span className="text-xs font-mono text-indigo-300 font-bold">{progress}%</span>
    </div>
  );
}

// ─── Field ────────────────────────────────────────────────────────────────────
function Field({ label, value, onChange, placeholder, type = "text", rows, allowUpload }: FieldProps) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const base =
    "w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40 transition-all font-mono";

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImageToS3(file);
      if (url) onChange(url);
    } catch (err) {
      console.error("Upload failed", err);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">{label}</label>
        {allowUpload && (
          <div>
            <input type="file" ref={fileInputRef} className="hidden" onChange={handleUpload} />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-mono transition-colors disabled:opacity-50"
            >
              {uploading ? "Uploading..." : "Upload File"}
            </button>
          </div>
        )}
      </div>
      {rows ? (
        <textarea className={base} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      ) : (
        <input className={base} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      )}
    </div>
  );
}

// ─── Toggle ───────────────────────────────────────────────────────────────────
function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-colors ${checked ? "bg-indigo-600" : "bg-zinc-200 dark:bg-zinc-700"}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? "left-5" : "left-0.5"}`} />
      </button>
    </div>
  );
}

// ─── Result Card ──────────────────────────────────────────────────────────────
function ResultCard({ task, label }: ResultCardProps) {
  if (!task) return (
    <div className="h-full min-h-[300px] lg:min-h-full flex flex-col items-center justify-center border border-dashed border-zinc-300 dark:border-zinc-700 rounded-2xl bg-zinc-50/50 dark:bg-zinc-900/20 p-6">
      <div className="w-16 h-16 mb-4 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-3xl opacity-50">🌌</div>
      <p className="text-zinc-500 text-sm font-mono text-center">No active task. Provide inputs and create a task to view results.</p>
    </div>
  );
  console.log("task:", task)
  const urls = task.model_urls ?? {};
  const thumbs = task.thumbnail_urls ?? [];

  return (
    <div className="h-full lg:min-h-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-2xl p-6 space-y-4 shadow-sm min-h-[300px] overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-zinc-400 dark:text-zinc-500">{label ?? task.id}</span>
        <StatusBadge status={task.status} />
      </div>

      {task.progress !== undefined && task.status !== "SUCCEEDED" && (
        <div className="flex items-center gap-3">
          <ProgressRing progress={task.progress} />
          <span className="text-xs text-zinc-400 dark:text-zinc-500 font-mono">Processing…</span>
        </div>
      )}

      {thumbs.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {thumbs.map((u, i) => (
            <img key={i} src={u} alt="thumb" className="w-20 h-20 rounded-lg object-cover border border-zinc-300 dark:border-zinc-700" />
          ))}
        </div>
      )}

      {Object.keys(urls).length > 0 && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Model URLs</p>
            {Object.entries(urls).map(([fmt, url]) => (
              <div key={fmt} className="flex items-center gap-2">
                <span className="text-xs font-mono text-indigo-400 w-8">{fmt}</span>
                <a
                  href={url} target="_blank" rel="noreferrer"
                  className="text-xs text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:text-white underline underline-offset-2 truncate max-w-xs transition-colors"
                >
                  {url}
                </a>
              </div>
            ))}
          </div>
          {urls.glb && (
            <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden relative">
              <GlbViewer modelUrl={urls.glb} className="h-[400px]" />
            </div>
          )}
        </div>
      )}

      {(task.image_urls?.length ?? 0) > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Images</p>
          <div className="flex flex-col gap-4">
            {task.image_urls!.map((u, i) => (
              <a key={i} href={u} target="_blank" rel="noreferrer" className="block w-full relative">
                <img src={u} alt={`img-${i}`} className="w-full h-full rounded-lg object-contain border border-zinc-300 dark:border-zinc-700 hover:border-indigo-500 transition-colors" />
              </a>
            ))}
          </div>
        </div>
      )}

      {task.error && (
        <p className="text-xs text-red-400 font-mono bg-red-500/10 rounded px-3 py-2">{task.error}</p>
      )}
    </div>
  );
}

// ─── Shared UI ────────────────────────────────────────────────────────────────
function Btn({ children, onClick, loading = false, variant = "primary", className = "" }: BtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`inline-flex justify-center items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-mono font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${className}
        ${variant === "primary"
          ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 dark:shadow-indigo-900/30"
          : "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700"}`}
    >
      {loading && (
        <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5">
      <span className="text-red-400 text-sm mt-0.5">⚠</span>
      <p className="text-xs text-red-300 font-mono">{msg}</p>
    </div>
  );
}

// ─── PANELS ───────────────────────────────────────────────────────────────────

function TextTo3DPanel({ apiKey, onTaskComplete }: PanelProps) {
  const [prompt, setPrompt] = useState("");
  const [negPrompt, setNegPrompt] = useState("");
  const [remesh, setRemesh] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [task, setTask] = useState<MeshyTask | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"preview" | "refine" | "generate">("preview");
  const [previewId, setPreviewId] = useState("");

  const reportDone = (t: MeshyTask) => {
    if (t.status === "SUCCEEDED") onTaskComplete?.(t, "text-to-3d");
  };

  async function createPreview() {
    setLoading(true); setError(""); setTask(null);
    try {
      const data = await meshyPost(apiKey, "text-to-3d", {
        mode: "preview", prompt, negative_prompt: negPrompt || undefined, should_remesh: remesh,
      });
      setTaskId(data.result);
      setTask({ id: data.result, status: "PENDING", progress: 0 });
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  async function createRefine() {
    setLoading(true); setError(""); setTask(null);
    try {
      const data = await meshyPost(apiKey, "text-to-3d", { mode: "refine", preview_task_id: previewId });
      setTaskId(data.result);
      setTask({ id: data.result, status: "PENDING", progress: 0 });
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  async function generate() {
    setLoading(true); setError(""); setTask(null);
    try {
      const pd = await meshyPost(apiKey, "text-to-3d", {
        mode: "preview", prompt, negative_prompt: negPrompt || undefined, should_remesh: remesh,
      });
      const pId: string = pd.result;
      setTask({ id: pId, status: "PENDING", progress: 0 });
      await pollTask(apiKey, "text-to-3d", pId, (t) => setTask({ ...t, label: "Preview" }));
      const rd = await meshyPost(apiKey, "text-to-3d", { mode: "refine", preview_task_id: pId });
      const rId: string = rd.result;
      setTask({ id: rId, status: "PENDING", progress: 0 });
      const rTask = await pollTask(apiKey, "text-to-3d", rId, (t) => setTask({ ...t, label: "Refined" }));
      const final = { ...rTask, label: "Refined — Complete" };
      setTask(final);
      reportDone(rTask);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  async function checkStatus() {
    if (!taskId) return;
    setLoading(true); setError("");
    try {
      const t: MeshyTask = await meshyGet(apiKey, `v2/text-to-3d/${taskId}`);
      setTask(t);
      reportDone(t);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  const handleAction = mode === "preview" ? createPreview : mode === "refine" ? createRefine : generate;
  const actionLabel = mode === "generate" ? "⚡ Full Generate" : mode === "preview" ? "▶ Create Preview" : "▶ Create Refine";

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-full flex-1">
      <div className="w-full lg:w-[320px] xl:w-[360px] flex-shrink-0 space-y-5 bg-white/40 dark:bg-zinc-950/40 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800/80">
        <div className="flex gap-1 p-1 bg-zinc-100 dark:bg-zinc-800/50 rounded-xl">
          {(["preview", "refine", "generate"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`flex-1 px-2 py-2 rounded-lg text-[10px] sm:text-xs font-mono font-semibold uppercase tracking-wider transition-all ${mode === m ? "bg-white dark:bg-zinc-700 text-indigo-600 dark:text-white shadow-sm" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"}`}>
              {m}
            </button>
          ))}
        </div>

        {(mode === "preview" || mode === "generate") && (
          <div className="space-y-4">
            <Field label="Prompt" value={prompt} onChange={setPrompt} placeholder="A medieval iron sword with ornate engravings…" rows={3} />
            <Field label="Negative Prompt" value={negPrompt} onChange={setNegPrompt} placeholder="low quality, blurry…" />
            <Toggle label="Should Remesh" checked={remesh} onChange={setRemesh} />
          </div>
        )}

        {mode === "refine" && (
          <Field label="Preview Task ID" value={previewId} onChange={setPreviewId} placeholder="task_xxxxxxxxxxxxxxxx" />
        )}

        <div className="pt-2">
          <Btn onClick={handleAction} loading={loading} className="w-full">{actionLabel}</Btn>
        </div>

        <div className="border-t border-zinc-200 dark:border-zinc-800 pt-5 mt-5 space-y-4">
          <Field label="Check Task ID" value={taskId} onChange={setTaskId} placeholder="task_xxxxxxxxxxxxxxxx" />
          <Btn onClick={checkStatus} loading={loading} variant="secondary" className="w-full">◎ Get Status</Btn>
        </div>

        {error && <ErrorBox msg={error} />}
      </div>

      <div className="flex-1 min-w-0">
        <ResultCard task={task} label={task?.label ?? "Task"} />
      </div>
    </div>
  );
}

function ImageTo3DPanel({ apiKey, initialTaskId = "", initialImageUrl = "", onTaskComplete }: PanelProps) {
  const [imageUrl, setImageUrl] = useState(initialImageUrl);
  const [remesh, setRemesh] = useState(false);
  const [texture, setTexture] = useState(true);
  const [taskId, setTaskId] = useState(initialTaskId);
  const [task, setTask] = useState<MeshyTask | null>(
    initialTaskId ? { id: initialTaskId, status: "PENDING", progress: 0 } : null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reportDone = (t: MeshyTask) => {
    if (t.status === "SUCCEEDED") onTaskComplete?.(t, "image-to-3d");
  };

  // Auto-fetch status when a taskId is pre-filled from router state
  useEffect(() => {
    if (initialTaskId && apiKey) {
      setLoading(true);
      meshyGet(apiKey, `v1/image-to-3d/${initialTaskId}`)
        .then((t: MeshyTask) => { setTask(t); reportDone(t); })
        .catch((e: any) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [initialTaskId, apiKey]);

  async function create() {
    setLoading(true); setError(""); setTask(null);
    try {
      const data = await meshyPost(apiKey, "image-to-3d", {
        image_url: imageUrl, should_remesh: remesh, should_texture: texture,
      });
      setTaskId(data.result);
      setTask({ id: data.result, status: "PENDING", progress: 0 });
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  async function checkStatus() {
    if (!taskId) return;
    setLoading(true); setError("");
    try {
      const t: MeshyTask = await meshyGet(apiKey, `v1/image-to-3d/${taskId}`);
      setTask(t);
      reportDone(t);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  async function poll() {
    if (!taskId) return;
    setLoading(true); setError("");
    try {
      const t = await pollTask(apiKey, "v1/image-to-3d", taskId, setTask);
      setTask(t);
      reportDone(t);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-full flex-1">
      <div className="w-full lg:w-[320px] xl:w-[360px] flex-shrink-0 space-y-5 bg-white/40 dark:bg-zinc-950/40 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800/80">
        <Field label="Image URL" value={imageUrl} onChange={setImageUrl} placeholder="https://…/image.png" allowUpload />
        <Toggle label="Should Remesh" checked={remesh} onChange={setRemesh} />
        <Toggle label="Should Texture" checked={texture} onChange={setTexture} />
        <div className="pt-2">
          <Btn onClick={create} loading={loading} className="w-full">▶ Create Task</Btn>
        </div>

        <div className="border-t border-zinc-200 dark:border-zinc-800 pt-5 mt-5 space-y-4">
          <Field label="Task ID" value={taskId} onChange={setTaskId} placeholder="task_xxxxxxxxxxxxxxxx" />
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={checkStatus} loading={loading} variant="secondary" className="w-full">◎ Status</Btn>
            <Btn onClick={poll} loading={loading} variant="secondary" className="w-full">⟳ Poll</Btn>
          </div>
        </div>

        {error && <ErrorBox msg={error} />}
      </div>

      <div className="flex-1 min-w-0">
        <ResultCard task={task} label="Image → 3D" />
      </div>
    </div>
  );
}

function TextToImagePanel({ apiKey }: PanelProps) {
  const [prompt, setPrompt] = useState("");
  const [negPrompt, setNegPrompt] = useState("");
  const [stylePreset, setStylePreset] = useState("");
  const [taskId, setTaskId] = useState("");
  const [task, setTask] = useState<MeshyTask | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const styles = ["", "realistic", "cartoon", "low-poly", "sculpture", "pbr"];

  async function create() {
    setLoading(true); setError(""); setTask(null);
    try {
      const data = await meshyPost(apiKey, "text-to-image", {
        prompt, negative_prompt: negPrompt || undefined, style_preset: stylePreset || undefined, "ai_model": "nano-banana",

      });
      setTaskId(data.result);
      setTask({ id: data.result, status: "PENDING", progress: 0 });
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  async function poll() {
    if (!taskId) return;
    setLoading(true); setError("");
    try {
      const t = await pollTask(apiKey, "v1/text-to-image", taskId, setTask);
      setTask(t);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-full flex-1">
      <div className="w-full lg:w-[320px] xl:w-[360px] flex-shrink-0 space-y-5 bg-white/40 dark:bg-zinc-950/40 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800/80">
        <Field label="Prompt" value={prompt} onChange={setPrompt} placeholder="A futuristic cityscape at dusk…" rows={3} />
        <Field label="Negative Prompt" value={negPrompt} onChange={setNegPrompt} placeholder="blurry, dark…" />
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Style Preset</label>
          <div className="flex flex-wrap gap-1.5">
            {styles.map((s) => (
              <button key={s} onClick={() => setStylePreset(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all border ${stylePreset === s ? "bg-indigo-600 text-white border-indigo-600 shadow-sm" : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-indigo-400 dark:hover:border-indigo-500"}`}>
                {s || "none"}
              </button>
            ))}
          </div>
        </div>
        <div className="pt-2">
          <Btn onClick={create} loading={loading} className="w-full">▶ Create Task</Btn>
        </div>

        <div className="border-t border-zinc-200 dark:border-zinc-800 pt-5 mt-5 space-y-4">
          <Field label="Task ID" value={taskId} onChange={setTaskId} placeholder="task_xxxxxxxxxxxxxxxx" />
          <Btn onClick={poll} loading={loading} variant="secondary" className="w-full">⟳ Poll Until Done</Btn>
        </div>

        {error && <ErrorBox msg={error} />}
      </div>

      <div className="flex-1 min-w-0">
        <ResultCard task={task} label="Text → Image" />
      </div>
    </div>
  );
}

function RemeshPanel({ apiKey, onTaskComplete, initialModelUrl = "" }: PanelProps) {
  const [modelUrl, setModelUrl] = useState(initialModelUrl);

  useEffect(() => {
    if (initialModelUrl && !modelUrl) {
      setModelUrl(initialModelUrl);
    }
  }, [initialModelUrl]);
  const [formats, setFormats] = useState("glb");
  const [topology, setTopology] = useState<"quad" | "triangle">("quad");
  const [polycount, setPolycount] = useState("30000");
  const [taskId, setTaskId] = useState("");
  const [task, setTask] = useState<MeshyTask | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reportDone = (t: MeshyTask) => {
    if (t.status === "SUCCEEDED") onTaskComplete?.(t, "remesh");
  };

  async function create() {
    setLoading(true); setError(""); setTask(null);
    try {
      const data = await meshyPost(apiKey, "remesh", {
        model_url: modelUrl,
        target_formats: formats.split(",").map((s) => s.trim()).filter(Boolean),
        topology,
        target_polycount: parseInt(polycount) || undefined,
      });
      setTaskId(data.result);
      setTask({ id: data.result, status: "PENDING" });
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  async function checkStatus() {
    if (!taskId) return;
    setLoading(true); setError("");
    try {
      const t: MeshyTask = await meshyGet(apiKey, `v1/remesh/${taskId}`);
      setTask(t);
      reportDone(t);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-full flex-1">
      <div className="w-full lg:w-[320px] xl:w-[360px] flex-shrink-0 space-y-5 bg-white/40 dark:bg-zinc-950/40 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800/80">
        <Field label="Model URL" value={modelUrl} onChange={setModelUrl} placeholder="https://…/model.glb" allowUpload />
        <Field label="Target Formats (comma-sep)" value={formats} onChange={setFormats} placeholder="glb, fbx, obj" />
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Topology</label>
          <div className="flex gap-2 p-1 bg-zinc-100 dark:bg-zinc-800/50 rounded-xl">
            {(["quad", "triangle"] as const).map((t) => (
              <button key={t} onClick={() => setTopology(t)}
                className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-mono transition-all ${topology === t ? "bg-white dark:bg-zinc-700 text-indigo-600 dark:text-white shadow-sm" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <Field label="Target Polycount" value={polycount} onChange={setPolycount} placeholder="30000" type="number" />
        <div className="pt-2">
          <Btn onClick={create} loading={loading} className="w-full">▶ Create Task</Btn>
        </div>

        <div className="border-t border-zinc-200 dark:border-zinc-800 pt-5 mt-5 space-y-4">
          <Field label="Task ID" value={taskId} onChange={setTaskId} placeholder="task_xxxxxxxxxxxxxxxx" />
          <Btn onClick={checkStatus} loading={loading} variant="secondary" className="w-full">◎ Get Status</Btn>
        </div>

        {error && <ErrorBox msg={error} />}
      </div>

      <div className="flex-1 min-w-0">
        <ResultCard task={task} label="Remesh" />
      </div>
    </div>
  );
}

function RetexturePanel({ apiKey, onTaskComplete, initialModelUrl = "" }: PanelProps) {
  const [modelUrl, setModelUrl] = useState(initialModelUrl);

  useEffect(() => {
    if (initialModelUrl && !modelUrl) {
      setModelUrl(initialModelUrl);
    }
  }, [initialModelUrl]);
  const [objPrompt, setObjPrompt] = useState("");
  const [stylePrompt, setStylePrompt] = useState("");
  const [negPrompt, setNegPrompt] = useState("");
  const [taskId, setTaskId] = useState("");
  const [task, setTask] = useState<MeshyTask | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reportDone = (t: MeshyTask) => {
    if (t.status === "SUCCEEDED") onTaskComplete?.(t, "retexture");
  };

  async function create() {
    setLoading(true); setError(""); setTask(null);
    try {
      const data = await meshyPost(apiKey, "retexture", {
        model_url: modelUrl, object_prompt: objPrompt,
        style_prompt: stylePrompt || undefined, negative_prompt: negPrompt || undefined,
      });
      setTaskId(data.result);
      setTask({ id: data.result, status: "PENDING" });
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  async function poll() {
    if (!taskId) return;
    setLoading(true); setError("");
    try {
      const t = await pollTask(apiKey, "v1/retexture", taskId, setTask);
      setTask(t);
      reportDone(t);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-full flex-1">
      <div className="w-full lg:w-[320px] xl:w-[360px] flex-shrink-0 space-y-5 bg-white/40 dark:bg-zinc-950/40 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800/80">
        <Field label="Model URL" value={modelUrl} onChange={setModelUrl} placeholder="https://…/model.glb" allowUpload />
        <Field label="Object Prompt" value={objPrompt} onChange={setObjPrompt} placeholder="a wooden chair" rows={2} />
        <Field label="Style Prompt" value={stylePrompt} onChange={setStylePrompt} placeholder="rustic farmhouse style" />
        <Field label="Negative Prompt" value={negPrompt} onChange={setNegPrompt} placeholder="dark, dirty…" />
        <div className="pt-2">
          <Btn onClick={create} loading={loading} className="w-full">▶ Create Task</Btn>
        </div>

        <div className="border-t border-zinc-200 dark:border-zinc-800 pt-5 mt-5 space-y-4">
          <Field label="Task ID" value={taskId} onChange={setTaskId} placeholder="task_xxxxxxxxxxxxxxxx" />
          <Btn onClick={poll} loading={loading} variant="secondary" className="w-full">⟳ Poll Until Done</Btn>
        </div>

        {error && <ErrorBox msg={error} />}
      </div>

      <div className="flex-1 min-w-0">
        <ResultCard task={task} label="Retexture" />
      </div>
    </div>
  );
}

function RiggingPanel({ apiKey, onTaskComplete, initialModelUrl = "" }: PanelProps) {
  const [modelUrl, setModelUrl] = useState(initialModelUrl);

  useEffect(() => {
    if (initialModelUrl && !modelUrl) {
      setModelUrl(initialModelUrl);
    }
  }, [initialModelUrl]);
  const [taskId, setTaskId] = useState("");
  const [task, setTask] = useState<MeshyTask | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reportDone = (t: MeshyTask) => {
    if (t.status === "SUCCEEDED") onTaskComplete?.(t, "rigging");
  };

  async function create() {
    setLoading(true); setError(""); setTask(null);
    try {
      const data = await meshyPost(apiKey, "rigging", { model_url: modelUrl });
      setTaskId(data.result);
      setTask({ id: data.result, status: "PENDING" });
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  async function checkStatus() {
    if (!taskId) return;
    setLoading(true); setError("");
    try {
      const t: MeshyTask = await meshyGet(apiKey, `v1/rigging/${taskId}`);
      setTask(t);
      reportDone(t);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-full flex-1">
      <div className="w-full lg:w-[320px] xl:w-[360px] flex-shrink-0 space-y-5 bg-white/40 dark:bg-zinc-950/40 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800/80">
        <Field label="Model URL" value={modelUrl} onChange={setModelUrl} placeholder="https://…/model.glb" allowUpload />
        <div className="pt-2">
          <Btn onClick={create} loading={loading} className="w-full">▶ Create Rigging Task</Btn>
        </div>

        <div className="border-t border-zinc-200 dark:border-zinc-800 pt-5 mt-5 space-y-4">
          <Field label="Task ID" value={taskId} onChange={setTaskId} placeholder="task_xxxxxxxxxxxxxxxx" />
          <Btn onClick={checkStatus} loading={loading} variant="secondary" className="w-full">◎ Get Status</Btn>
        </div>

        {error && <ErrorBox msg={error} />}
      </div>

      <div className="flex-1 min-w-0">
        <ResultCard task={task} label="Rigging" />
      </div>
    </div>
  );
}

function BalancePanel({ apiKey }: PanelProps) {
  const [balance, setBalance] = useState<MeshyBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function fetchBalance() {
    setLoading(true); setError("");
    try {
      const data: MeshyBalance = await meshyGet(apiKey, "v1/balance");
      setBalance(data);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">Fetch your current Meshy account credit balance.</p>
      <div>
        <Btn onClick={fetchBalance} loading={loading}>◎ Check Balance</Btn>
      </div>
      {error && <ErrorBox msg={error} />}
      {balance && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-2xl p-8 shadow-sm">
          <p className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-3">Account Balance</p>
          <div className="text-4xl font-mono font-bold text-indigo-300">
            {balance.balance?.toLocaleString() ?? "—"}
          </div>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">credits</p>
          {Object.entries(balance)
            .filter(([k]) => k !== "balance")
            .map(([k, v]) => (
              <div key={k} className="flex justify-between mt-2 text-xs font-mono">
                <span className="text-zinc-400 dark:text-zinc-500">{k}</span>
                <span className="text-zinc-700 dark:text-zinc-300">{String(v)}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ─── Panel Registry ───────────────────────────────────────────────────────────
const PANEL_MAP: Record<string, React.FC<PanelProps>> = {
  "text-to-3d": TextTo3DPanel,
  "image-to-3d": ImageTo3DPanel,
  "text-to-image": TextToImagePanel,
  remesh: RemeshPanel,
  retexture: RetexturePanel,
  rigging: RiggingPanel,
  balance: BalancePanel,
};

// ─── Main App ─────────────────────────────────────────────────────────────────
const ENTITY_ID = "69d0b54cad8abad1ca92d84b";

export default function MeshyStudio() {
  const [isDark, setIsDark] = useState(false);
  const apiKey = import.meta.env.VITE_MESHY_API_KEY || "";
  const location = useLocation();
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();

  const [searchParams] = useSearchParams();
  const [sessionTasks, setSessionTasks] = useState<MeshyTask[]>([]);

  // ── Incoming state from ImageApiProcessor ─────────────────────────
  const incomingState = (location.state as {
    taskId?: string; glbUrl?: string; imageUrl?: string; fromRoom?: number;
  } | null) ?? {};

  // Try to use query params first, fallback to location state
  const incomingTaskId = searchParams.get('taskId') || incomingState.taskId || "";
  const roomIndexParam = searchParams.get('roomIndex');
  const roomIndex = roomIndexParam ? parseInt(roomIndexParam, 10) : (incomingState.fromRoom ?? 0);
  const incomingImageUrl = incomingState.imageUrl || "";

  // Initialize a state to hold the glbUrl we might reconstruct or fetch
  const [initialModelUrl, setInitialModelUrl] = useState<string>("");

  // Find glbUrl from sessionTasks if task is completed
  useEffect(() => {
    if (incomingTaskId && sessionTasks.length > 0) {
      const task = sessionTasks.find(t => t.id === incomingTaskId || (t as any).result === incomingTaskId);
      if (task?.model_urls?.glb) {
        setInitialModelUrl(task.model_urls.glb);
      }
    }
  }, [incomingTaskId, sessionTasks]);

  // ── UI state ──────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<string>(
    incomingTaskId ? "image-to-3d" : "text-to-3d"
  );
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // ── Backend record state ───────────────────────────────────────────
  // Accumulated task stubs for this session — saved to backend on each SUCCESS
  // Rooms array loaded from backend (for selective update)
  const roomsRef = useRef<any[]>([]);

  // Load existing 3dId stubs from backend when we have an id
  useEffect(() => {
    if (!id) return;
    getDataSpecificById(ENTITY_ID, id)
      .then((res: any) => {
        if (res.success && Array.isArray(res.data?.rooms)) {
          roomsRef.current = res.data.rooms;
          const existing3d: any[] = res.data.rooms[roomIndex]?.['3dId'] ?? [];
          // Hydrate sessionTasks from existing stubs so the counter is accurate
          setSessionTasks(existing3d.filter((s: any) => s?.status === "SUCCEEDED"));
        }
      })
      .catch(console.error);
  }, [id, roomIndex]);

  // ── Persist newly completed task stub to backend ───────────────────
  const handleTaskComplete = async (task: MeshyTask, panelId: string) => {
    const stub = { ...task, _panelSource: panelId, _savedAt: new Date().toISOString() };
    setSessionTasks(prev => [...prev, stub]);

    if (!id) return; // standalone mode — just accumulate in state

    try {
      // Fetch fresh data first to avoid overwriting recent changes (e.g. newly added rooms in other tabs)
      const freshRes = await getDataSpecificById(ENTITY_ID, id);
      let latestRooms = roomsRef.current;
      if (freshRes?.success && Array.isArray(freshRes?.data?.rooms)) {
        latestRooms = freshRes.data.rooms;
      }

      // Build latest rooms array, appending new stub to the correct room's 3dId
      const rooms: any[] = latestRooms.length > 0
        ? [...latestRooms]
        : [{ roomName: `Room ${roomIndex + 1}` }];

      while (rooms.length <= roomIndex) rooms.push({ roomName: `Room ${rooms.length + 1}` });

      const existing3d: any[] = Array.isArray(rooms[roomIndex]?.['3dId'])
        ? rooms[roomIndex]['3dId']
        : [];

      const checkId = stub.id || (stub as any).result;
      const existingIdx = existing3d.findIndex((t: any) =>
        (t.id && t.id === checkId) || (t.result && t.result === checkId)
      );

      if (existingIdx !== -1) {
        // Update the existing entry
        existing3d[existingIdx] = { ...existing3d[existingIdx], ...stub };
        rooms[roomIndex]['3dId'] = [...existing3d];
      } else {
        // Append conditionally new task
        rooms[roomIndex]['3dId'] = [...existing3d, stub];
      }

      roomsRef.current = rooms;

      // --- Save to Global Asset Library ---
      try {
        const LIBRARY_DATA_ID = "69b790eb854afa550e7741a6";
        const checkId = stub.id || (stub as any).result;

        // Search by result or id to see if it already exists in the library
        // const existing = await getServiceByEntity(LIBRARY_DATA_ID, { result: checkId });

        // If no results found (either empty array or null)
        // if (!existing || (Array.isArray(existing) && existing.length === 0)) {
          const assetToSave = { ...stub, prompt: (task as any).prompt || "" };
          await postServiceByEntity(LIBRARY_DATA_ID, assetToSave);
          console.log(`[MeshyStudio] Saved task ${checkId} to Global Library`);
        // }
      } catch (libErr) {
        console.error("Failed to save task to library:", libErr);
      }

      // await updateServiceByEntity(ENTITY_ID, id, { rooms });
      console.log(`[MeshyStudio] Saved ${panelId} task ${task.id} to room ${roomIndex}`);
    } catch (err) {
      console.error("Failed to save task to backend:", err);
    }
  };

  // ── Finish & Move to 3D ───────────────────────────────────────────
  const handleFinish = async () => {
    if (!id) {
      navigate("/building-configurator");
      return;
    }
    setFinishing(true);
    try {
      // Final save — make sure roomsRef is up to date (already updated by handleTaskComplete)
      // but do one more explicit update to ensure latest state is persisted
      if (roomsRef.current.length > 0) {
        await updateServiceByEntity(ENTITY_ID, id, { rooms: roomsRef.current });
      }
    } catch (err) {
      console.error("Final save error (non-blocking):", err);
    } finally {
      setFinishing(false);
      navigate(`/building-configurator/${id}`);
    }
  };

  const Panel = PANEL_MAP[activeTab];
  const panelProps: PanelProps = {
    apiKey,
    onTaskComplete: handleTaskComplete,
    initialModelUrl,
    ...(activeTab === "image-to-3d" && incomingTaskId
      ? { initialTaskId: incomingTaskId, initialImageUrl: incomingImageUrl }
      : {}),
  };

  return (
    <div className={`h-[100dvh] ${isDark ? "dark" : ""} transition-colors duration-300`}>
      <div className="h-full w-full bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex flex-col overflow-hidden" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
        {/* Ambient BG */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
          <div className="absolute -top-32 -left-32 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl" />
          <div className="absolute top-1/2 -right-48 w-96 h-96 bg-violet-600/8 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-1/2 w-64 h-64 bg-sky-600/6 rounded-full blur-3xl" />
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: "linear-gradient(#6366f1 1px, transparent 1px), linear-gradient(90deg, #6366f1 1px, transparent 1px)",
              backgroundSize: "48px 48px",
            }}
          />
        </div>

        <div className="relative z-10 w-full h-full flex flex-col p-3 sm:p-4 lg:p-6 pb-0 sm:pb-0 lg:pb-0">
          {/* Header */}
          <div className="flex flex-row items-center justify-between mb-4 pb-4 border-b border-zinc-200 dark:border-zinc-800 gap-4 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-xl shadow-lg shadow-indigo-500/30 text-white">⬡</div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-white leading-none">MESHY STUDIO</h1>
                {id && (
                  <p className="text-[10px] font-mono text-zinc-400 mt-0.5 truncate max-w-[200px]">
                    Record: <span className="text-indigo-400">{id}</span>
                    {" · "}
                    <span className="text-emerald-400">{sessionTasks.length} task{sessionTasks.length !== 1 ? "s" : ""} saved</span>
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Session tasks badge */}
              {sessionTasks.length > 0 && (
                <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[11px] font-mono font-semibold text-emerald-400">
                    {sessionTasks.length} succeeded
                  </span>
                </div>
              )}
              {/* Finish button */}
              <button
                onClick={handleFinish}
                disabled={finishing}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-mono font-bold transition-all shadow-lg
                  bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500
                  text-white shadow-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {finishing ? (
                  <><svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" /></svg>Saving…</>
                ) : (
                  <><span>✦</span><span className="hidden sm:inline">Finish &amp; Move to 3D</span><span className="sm:hidden">Finish</span></>
                )}
              </button>
              <button onClick={() => setIsDark(!isDark)} className="flex items-center justify-center w-10 h-10 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all shadow-sm">
                {isDark ? "☀️" : "🌙"}
              </button>
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-4 lg:gap-6 flex-1 min-h-[0]">
            {/* Sidebar / Tabs */}
            <div className="w-full md:w-56 lg:w-64 flex-shrink-0 flex flex-col">
              <div className="flex md:flex-col gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-hide shrink-0 md:h-full md:overflow-y-auto">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-mono font-semibold transition-all whitespace-nowrap md:whitespace-normal
                    ${activeTab === t.id
                        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 dark:shadow-indigo-900/40 md:translate-x-2"
                        : "bg-white/50 dark:bg-zinc-900/50 text-zinc-600 dark:text-zinc-400 hover:bg-white dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-200 border border-zinc-200/50 dark:border-zinc-800/50 md:translate-x-0"}`}
                  >
                    <span className="text-xl leading-none">{t.icon}</span>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Footer Desktop */}
              <div className="hidden md:flex flex-col gap-2 mt-auto pt-4 border-t border-zinc-200/50 dark:border-zinc-800/50 pb-2">
                {/* Session tasks summary */}
                {sessionTasks.length > 0 && (
                  <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5">
                    <p className="text-[10px] font-mono font-semibold text-emerald-500 uppercase tracking-widest mb-1">Saved this session</p>
                    <div className="space-y-1 max-h-28 overflow-y-auto">
                      {sessionTasks.slice(-5).reverse().map((t, i) => (
                        <div key={i} className="flex items-center justify-between gap-1">
                          <span className="text-[10px] font-mono text-emerald-400 truncate">{t._panelSource ?? "task"}</span>
                          <span className="text-[9px] font-mono text-emerald-600 truncate max-w-[100px]">{t.id?.slice(-8)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <a href="https://docs.meshy.ai" target="_blank" rel="noreferrer" className="text-xs font-mono text-zinc-400 hover:text-indigo-500 transition-colors inline-flex items-center gap-1 justify-center">
                  docs.meshy.ai <span className="text-[10px]">↗</span>
                </a>
              </div>
            </div>

            {/* Main Panel Content */}
            <div className="flex-1 min-w-0 flex flex-col h-full bg-white/60 dark:bg-zinc-900/60 backdrop-blur-md border border-zinc-200 dark:border-zinc-800 rounded-tr-3xl rounded-tl-3xl md:rounded-3xl overflow-hidden shadow-sm md:mb-6">
              <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-200/50 dark:border-zinc-800/50 shrink-0 bg-white/40 dark:bg-zinc-900/40">
                <span className="text-2xl">{TABS.find((t) => t.id === activeTab)?.icon}</span>
                <h2 className="text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-wider">
                  {TABS.find((t) => t.id === activeTab)?.label}
                </h2>
              </div>

              {/* Pre-fill banner */}
              {incomingTaskId && !bannerDismissed && (
                <div className="flex items-center justify-between gap-3 px-5 py-3 bg-indigo-600/10 border-b border-indigo-200/50 dark:border-indigo-800/40 shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-indigo-500 text-lg">◈</span>
                    <p className="text-xs font-mono text-indigo-700 dark:text-indigo-300 truncate">
                      Task <span className="font-bold">{incomingTaskId}</span> pre-filled from Image Processor
                      {incomingState.fromRoom !== undefined && ` (Room ${(incomingState.fromRoom as number) + 1})`}.
                      Check status or poll below.
                    </p>
                  </div>
                  <button
                    onClick={() => setBannerDismissed(true)}
                    className="text-indigo-400 hover:text-indigo-600 text-xs font-mono flex-shrink-0"
                  >
                    ✕
                  </button>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar flex flex-col">
                {apiKey ? (
                  <Panel {...panelProps} />
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center py-20 text-center bg-zinc-50/50 dark:bg-zinc-950/50 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 h-full">
                    <div className="text-5xl mb-4">🔑</div>
                    <p className="text-base font-mono font-semibold text-zinc-600 dark:text-zinc-300">API key not found</p>
                    <p className="text-sm font-mono text-zinc-500 dark:text-zinc-500 mt-2">Please set VITE_MESHY_API_KEY in your .env file.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer Mobile */}
          <div className="md:hidden mt-auto pt-3 border-t border-zinc-200/50 dark:border-zinc-800/50 pb-3 shrink-0 bg-zinc-50 dark:bg-zinc-950 relative z-20 flex items-center justify-between px-2">
            <a href="https://docs.meshy.ai" target="_blank" rel="noreferrer" className="text-xs font-mono text-zinc-400 hover:text-indigo-500 transition-colors inline-flex items-center gap-1">
              docs.meshy.ai <span className="text-[10px]">↗</span>
            </a>
            <button
              onClick={handleFinish}
              disabled={finishing}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-mono font-bold
                bg-gradient-to-r from-indigo-600 to-violet-600 text-white disabled:opacity-50"
            >
              {finishing ? "Saving…" : "✦ Finish & Move to 3D"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
