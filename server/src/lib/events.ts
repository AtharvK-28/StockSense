import type { RequestHandler, Response } from "express";

// Server-Sent Events: every open dashboard gets a nudge when stock or documents change,
// and refetches. No third-party realtime service needed.
const clients = new Set<Response>();

export type ChangeTopic = "documents" | "stock" | "products" | "settings" | "notifications";

export function broadcast(topic: ChangeTopic) {
  const payload = `event: change\ndata: ${JSON.stringify({ topic, at: Date.now() })}\n\n`;
  for (const res of clients) res.write(payload);
}

export const eventsHandler: RequestHandler = (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");
  clients.add(res);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
};
