import { createFileRoute } from "@tanstack/react-router";

// Speech-to-text proxy to Lovable AI Gateway (streaming SSE or single JSON).
export const Route = createFileRoute("/api/stt")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          console.error("[stt] LOVABLE_API_KEY is not set");
          return new Response("LOVABLE_API_KEY missing", { status: 500 });
        }
        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.includes("multipart/form-data")) return new Response("Expected multipart upload", { status: 400 });
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return new Response("Missing file", { status: 400 });
        if (file.size < 2048) return new Response("Recording was empty or too short", { status: 400 });
        if (file.size > 25 * 1024 * 1024) return new Response("Recording is too large", { status: 413 });
        const mime = file.type.split(";")[0] || "audio/wav";
        if (!mime.startsWith("audio/")) return new Response("Upload must be an audio file", { status: 400 });
        console.log("[stt] uploading to gateway", { name: file.name, size: file.size, mime });
        const upstream = new FormData();
        upstream.append("model", "openai/gpt-4o-mini-transcribe");
        upstream.append("file", file, file.name || filenameForAudio(mime));
        upstream.append("stream", "true");
        const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body: upstream,
        });
        console.log("[stt] gateway response", { status: res.status, contentType: res.headers.get("content-type") });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          console.error("[stt] gateway error", res.status, t.slice(0, 500));
          return new Response(`Transcription failed: ${res.status} ${t.slice(0, 200)}`, { status: res.status });
        }
        const upstreamType = res.headers.get("content-type") ?? "";
        if (upstreamType.includes("application/json")) {
          const body = await res.text();
          console.log("[stt] gateway returned JSON", body.slice(0, 500));
          return new Response(body, {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
          });
        }
        return new Response(res.body, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        });
      },
    },
  },
});

function filenameForAudio(mime: string) {
  const ext: Record<string, string> = {
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "webm",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
  };
  return `recording.${ext[mime] ?? "wav"}`;
}
