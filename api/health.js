export default function handler(_req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ status: "ok", service: "genai-trading-engine",
    model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
    mode: "research-and-paper-trading", liveOrderExecution: false });
}