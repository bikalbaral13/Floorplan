/**
 * Chat ▸ 🎤 — speech to text with the browser's own Web Speech API (Chrome, Edge, Safari; not Firefox).
 * Nothing is uploaded by us; the browser does the recognition. It needs a secure page (https or localhost),
 * so a phone on http://<LAN-ip>:2500 reports `unsupported` / a "not-allowed" error.
 *
 * `onText(finalText)` is called with each finished phrase; `interim` is the words still being heard.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type Rec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

const Ctor = (): (new () => Rec) | undefined => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

export function useDictation(onText: (text: string) => void) {
  const supported = !!Ctor() && (typeof window === "undefined" || window.isSecureContext);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Rec | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  /** keepAlive: restart by itself when the browser ends recognition after a silence (voice mode). */
  const keepAlive = useRef(false);
  const stop = useCallback(() => { keepAlive.current = false; rec.current?.stop(); }, []);

  const start = useCallback((opts?: { keepAlive?: boolean }) => {
    keepAlive.current = !!opts?.keepAlive;
    const C = Ctor();
    if (!C) return;
    setError(null);
    const r = new C();
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) onTextRef.current(res[0].transcript.trim());
        else live += res[0].transcript;
      }
      setInterim(live);
    };
    r.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") keepAlive.current = false; setError(e.error === "not-allowed" ? "Microphone blocked — allow it for this site (needs https)" : e.error === "no-speech" || e.error === "aborted" ? null : `Speech error: ${e.error}`); };
    r.onend = () => {
      setListening(false); setInterim(""); rec.current = null;
      // Chrome ends a session after a pause even with continuous=true; voice mode just carries on.
      if (keepAlive.current) window.setTimeout(() => { if (keepAlive.current && !rec.current) startRef.current?.({ keepAlive: true }); }, 250);
    };
    rec.current = r;
    r.start();
    setListening(true);
  }, []);

  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => () => { keepAlive.current = false; rec.current?.stop(); }, []);

  return { supported, listening, interim, error, start, stop, toggle: () => (rec.current ? stop() : start()) };
}
