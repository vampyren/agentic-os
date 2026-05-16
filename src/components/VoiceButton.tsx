"use client";

// Mic button using the browser's Web Speech API. Click to toggle. While
// listening, each interim transcript chunk is sent to onTranscript so the
// caller can append it to a textarea.
//
// Firefox doesn't implement the API; the button renders disabled there with
// a tooltip.

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
  onerror: ((event: unknown) => void) | null;
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
  const recRef = useRef<RecognitionLike | null>(null);

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
  }, []);

  function start() {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
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
        // Final results have an isFinal flag on the SpeechRecognitionResult;
        // we approximate using event.resultIndex but rely on the live append.
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
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);

    try { rec.start(); setListening(true); recRef.current = rec; }
    catch { setListening(false); }
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

  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      disabled={disabled}
      title={listening ? "Stop listening (recording…)" : "Start voice input"}
      className="!px-2.5 !py-2"
      style={listening ? { borderColor: "rgba(248,113,113,0.5)", color: "#fca5a5" } : undefined}
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
