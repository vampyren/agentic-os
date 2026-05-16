"use client";

// Mic button using the browser's Web Speech API. Click to toggle. While
// listening, each interim transcript chunk is sent to onTranscript so the
// caller can append it to a textarea.
//
// Compatibility:
// - Chrome / Edge: works.
// - Safari: works (with webkit prefix).
// - Firefox: does NOT implement the API.
// - Brave: limits or blocks because Chrome's implementation phones home
//   to Google for transcription; users see "not-allowed" or "network"
//   errors. Try Chromium/Chrome instead.
//
// On error we surface the actual error type (`not-allowed`, `network`,
// `service-not-allowed`, etc.) so the operator can debug.

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";

interface RecognitionLike {
  start(): void;
  stop(): void;
  abort(): void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number }) => void) | null;
  onerror: ((event: { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionCtor {
  new (): RecognitionLike;
}

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function VoiceButton({
  onTranscript,
  disabled = false,
}: {
  onTranscript: (chunk: string, isFinal: boolean) => void;
  disabled?: boolean;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const recRef = useRef<RecognitionLike | null>(null);

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
  }, []);

  // Stop and clean up the recognition session if the component unmounts
  // mid-listen (e.g., operator navigates away). Without this, the API keeps
  // an active session in the background and may not release the microphone
  // promptly.
  useEffect(() => {
    return () => {
      const r = recRef.current;
      if (!r) return;
      try { r.onresult = null; r.onerror = null; r.onend = null; } catch { /* ignore */ }
      try { r.abort(); } catch { /* ignore */ }
      recRef.current = null;
    };
  }, []);

  function start() {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    setLastError(null);
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";

    let lastFinalIdx = 0;
    rec.onresult = (event) => {
      const results = event.results;
      let interim = "";
      for (let i = lastFinalIdx; i < results.length; i++) {
        const r = results[i];
        if (!r || !r[0]) continue;
        const text = r[0].transcript;
        const isFinal = (results[i] as unknown as { isFinal?: boolean }).isFinal === true;
        if (isFinal) {
          onTranscript(text, true);
          lastFinalIdx = i + 1;
        } else {
          interim += text;
        }
      }
      if (interim) onTranscript(interim, false);
    };
    rec.onerror = (event) => {
      // event.error is one of: "no-speech", "aborted", "audio-capture",
      // "network", "not-allowed", "service-not-allowed", "bad-grammar",
      // "language-not-supported". Brave + Web Speech typically yields
      // "network" or "not-allowed".
      const err = (event && event.error) || "unknown";
      setLastError(err);
      setListening(false);
    };
    rec.onend = () => setListening(false);

    try {
      rec.start();
      setListening(true);
      recRef.current = rec;
    } catch (e) {
      setLastError(String(e).slice(0, 80));
      setListening(false);
    }
  }

  function stop() {
    try { recRef.current?.stop(); } catch { /* ignore */ }
    setListening(false);
  }

  if (!supported) {
    return (
      <button
        type="button"
        disabled
        title="Voice input requires Chrome, Edge, or Safari (Firefox doesn't support the Web Speech API)"
        className="!px-2.5 !py-2"
      >
        <MicOff size={14} className="opacity-50" />
      </button>
    );
  }

  const title = listening
    ? "Stop listening (recording…)"
    : lastError
      ? `Voice failed: ${lastError} — click to retry. Brave often blocks Web Speech; try Chrome.`
      : "Start voice input";

  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      disabled={disabled}
      title={title}
      className="!px-2.5 !py-2"
      style={
        listening
          ? { borderColor: "rgba(248,113,113,0.5)", color: "#fca5a5" }
          : lastError
            ? { borderColor: "rgba(245,158,11,0.5)", color: "#fbbf24" }
            : undefined
      }
    >
      {listening ? (
        <span className="flex items-center gap-1.5">
          <Mic size={14} />
          <span className="tick live" style={{ background: "#fca5a5", width: 6, height: 6 }} />
        </span>
      ) : (
        <Mic size={14} />
      )}
    </button>
  );
}
