import { createFileRoute } from "@tanstack/react-router";

// Speech-to-text proxy to Lovable AI Gateway (streaming SSE).
export const Route = createFileRoute("/api/stt")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("LOVABLE_API_KEY missing", { status: 500 });
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return new Response("Missing file", { status: 400 });
        const upstream = new FormData();
        upstream.append("model", "openai/gpt-4o-mini-transcribe");
        upstream.append("file", file, file.name || "recording.wav");
        upstream.append("stream", "true");
        const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body: upstream,
        });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          return new Response(`Transcription failed: ${res.status} ${t.slice(0, 200)}`, { status: res.status });
        }
        return new Response(res.body, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        });
      },
    },
  },
});
