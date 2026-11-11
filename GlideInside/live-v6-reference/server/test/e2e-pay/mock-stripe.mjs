import http from "node:http";
const PORT = +process.env.MOCK_STRIPE_PORT || 8811, KEY = "sk_test_mock", sessions = new Map(); let mode = "ok", n = 0;
const send = (res, s, o) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"); let body = ""; for await (const c of req) body += c;
  if (u.pathname === "/_mode") { mode = u.searchParams.get("m") || "ok"; return send(res, 200, { mode }); }
  if (u.pathname === "/_sessions") return send(res, 200, [...sessions.values()]);
  if (u.pathname === "/v1/checkout/sessions" && req.method === "POST") {
    if (mode === "down") { res.destroy(); return; }
    if (mode === "500") return send(res, 500, { error: { message: "boom" } });
    if (mode === "html") { res.writeHead(502, { "content-type": "text/html" }); return res.end("<html>bad gateway</html>"); }
    if (req.headers.authorization !== "Bearer " + KEY) return send(res, 401, { error: { message: "Invalid API Key provided" } });
    const form = Object.fromEntries(new URLSearchParams(body)); const id = "cs_test_" + String(++n).padStart(4, "0") + Math.random().toString(36).slice(2, 10);
    const s = { id, form, created: Date.now() }; sessions.set(id, s);
    return send(res, 200, { id, object: "checkout.session", url: `https://checkout.stripe.com/c/pay/${id}`, ...{ _form: undefined } });
  }
  send(res, 404, { error: { message: "No such route" } });
}).listen(PORT, "127.0.0.1", () => console.log("mock stripe on", PORT));
