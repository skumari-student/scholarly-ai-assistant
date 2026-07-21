import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";

// Records mic audio via Web Audio and encodes a 16kHz mono WAV, then streams it to /api/stt.
// - When `onCommand` is provided, the transcript is passed to `onCommand` (command mode).
// - Otherwise the transcript is passed to `onTranscript` (dictation).
export function VoiceCapture({
  onTranscript,
  onCommand,
  label,
  size = "sm",
  variant = "outline",
  compact = false,
}: {
  onTranscript?: (text: string) => void;
  onCommand?: (text: string) => void | Promise<void>;
  label?: string;
  size?: "sm" | "icon" | "default";
  variant?: "outline" | "ghost" | "secondary" | "default";
  compact?: boolean;
}) {
  const [state, setState] = useState<"idle" | "recording" | "processing">("idle");
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<ScriptProcessorNode | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const capturedRef = useRef(false);

  async function start() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error("Microphone recording is not available in this browser");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) throw new Error("Audio recording is not supported in this browser");
      const ctx = new AudioContextCtor();
      if (ctx.state === "suspended") await ctx.resume();
      ctxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      srcRef.current = src;
      const node = ctx.createScriptProcessor(4096, 1, 1);
      nodeRef.current = node;
      chunksRef.current = [];
      capturedRef.current = false;
      node.onaudioprocess = (e) => {
        if (!capturedRef.current) {
          capturedRef.current = true;
          console.log("[voice] onaudioprocess fired — audio graph is processing");
        }
        chunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      src.connect(node);
      // Route through a zero-gain node so the ScriptProcessor keeps running
      // without piping mic audio back out to the speakers (feedback risk).
      const sink = ctx.createGain();
      sink.gain.value = 0;
      node.connect(sink);
      sink.connect(ctx.destination);
      setState("recording");
    } catch (e) {
      console.error("[voice] start failed", e);
      toast.error("Microphone access denied");
    }
  }

  async function stop() {
    setState("processing");
    try {
      const ctx = ctxRef.current;
      if (!ctx) throw new Error("Recording was not started");
      nodeRef.current?.disconnect();
      srcRef.current?.disconnect();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const sampleRate = ctx.sampleRate;
      const chunks = chunksRef.current;
      await ctx.close();
      const wav = encodeWav(chunks, sampleRate, 16000);
      console.log("[voice] WAV encoded", { chunks: chunks.length, bytes: wav.size, sampleRate });
      if (wav.size < 2048) {
        toast.error("No speech was captured — please try again");
        setState("idle");
        return;
      }
      const form = new FormData();
      form.append("file", wav, "recording.wav");
      const res = await fetch("/api/stt", { method: "POST", body: form });
      console.log("[voice] /api/stt response", { status: res.status, contentType: res.headers.get("content-type") });
      if (!res.ok) {
        const message = await res.text().catch(() => "Transcription failed");
        console.error("[voice] /api/stt error", res.status, message);
        toast.error(message || "Transcription failed");
        setState("idle");
        return;
      }
      if (!res.body) {
        toast.error("Transcription response had no body");
        setState("idle");
        return;
      }
      const contentType = res.headers.get("content-type") ?? "";
      let transcript = "";
      if (contentType.includes("application/json")) {
        // Gateway returned a single JSON object instead of an SSE stream.
        const text = await res.text();
        console.log("[voice] JSON body from /api/stt", text.slice(0, 500));
        transcript = extractTranscriptFromJson(text);
      } else {
        transcript = await readSSEStream(res);
      }
      transcript = transcript.trim();
      console.log("[voice] final transcript", { length: transcript.length, preview: transcript.slice(0, 200), mode: onCommand ? "command" : "dictation" });
      if (transcript) {
        if (onCommand) await onCommand(transcript);
        else onTranscript?.(transcript);
      } else {
        toast.error("No transcript returned — try speaking a little longer");
      }
    } catch (e) {
      console.error("[voice] stop failed", e);
      toast.error(e instanceof Error ? e.message : "Recording failed");
    } finally {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      nodeRef.current = null;
      srcRef.current = null;
      ctxRef.current = null;
      setState("idle");
    }
  }

  async function readSSEStream(res: Response): Promise<string> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let deltas = "";
    const processEvents = (raw: string) => {
      const events = raw.split("\n\n");
      for (const ev of events) {
        const lines = ev.split("\n").filter((l) => l.startsWith("data:"));
        if (!lines.length) continue;
        const payload = lines.map((line) => line.slice(5).trim()).join("\n");
        if (!payload || payload === "[DONE]") continue;
        try {
          const obj = JSON.parse(payload);
          console.log("[voice] SSE event", { type: obj.type, keys: Object.keys(obj) });
          if (obj.type === "transcript.text.done" && obj.text) full = obj.text;
          else if (obj.type === "transcript.text.delta" && typeof obj.delta === "string") deltas += obj.delta;
          else if (typeof obj.text === "string" && !full) full = obj.text;
        } catch (e) {
          console.warn("[voice] malformed SSE event", payload.slice(0, 200), e);
        }
      }
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      processEvents(events.join("\n\n"));
    }
    buffer += decoder.decode();
    if (buffer.trim()) processEvents(buffer);
    return (full || deltas).trim();
  }

  function extractTranscriptFromJson(text: string): string {
    try {
      const obj = JSON.parse(text);
      if (typeof obj.text === "string") return obj.text;
      if (typeof obj.transcript === "string") return obj.transcript;
      if (obj.data && typeof obj.data.text === "string") return obj.data.text;
      console.warn("[voice] unexpected JSON shape", Object.keys(obj));
      return "";
    } catch (e) {
      console.warn("[voice] could not parse JSON body as JSON", e);
      return "";
    }
  }

  const iconOnly = compact || size === "icon";
  const isCommand = !!onCommand;
  const defaultLabel = isCommand ? "Voice command" : "Dictate";
  const Icon = isCommand ? Wand2 : Mic;
  return (
    <Button
      type="button"
      variant={variant}
      size={iconOnly ? "icon" : size}
      onClick={state === "recording" ? stop : start}
      disabled={state === "processing"}
      title={state === "recording" ? "Stop recording" : defaultLabel}
    >
      {state === "recording" ? (
        <>
          <Square className={`h-4 w-4 text-red-500 ${iconOnly ? "" : "mr-2"}`} />
          {!iconOnly && "Stop"}
        </>
      ) : state === "processing" ? (
        <>
          <Loader2 className={`h-4 w-4 animate-spin ${iconOnly ? "" : "mr-2"}`} />
          {!iconOnly && "Transcribing…"}
        </>
      ) : (
        <>
          <Icon className={`h-4 w-4 ${iconOnly ? "" : "mr-2"}`} />
          {!iconOnly && (label ?? defaultLabel)}
        </>
      )}
    </Button>
  );
}

function encodeWav(chunks: Float32Array[], sourceRate: number, targetRate: number): Blob {
  const merged = mergeChunks(chunks);
  const downsampled = targetRate === sourceRate ? merged : downsample(merged, sourceRate, targetRate);
  const buffer = new ArrayBuffer(44 + downsampled.length * 2);
  const view = new DataView(buffer);
  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + downsampled.length * 2, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(view, 36, "data");
  view.setUint32(40, downsampled.length * 2, true);
  let offset = 44;
  for (let i = 0; i < downsampled.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, downsampled[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function downsample(buffer: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  const ratio = sourceRate / targetRate;
  const newLength = Math.floor(buffer.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let sum = 0;
    for (let j = start; j < end; j++) sum += buffer[j];
    result[i] = sum / (end - start);
  }
  return result;
}

function writeStr(view: DataView, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}
