import hmac, hashlib, time, json, urllib.request
from playwright.sync_api import sync_playwright
BASE = "http://127.0.0.1:8810"; APP = BASE + "/plan-studio/app/"; WHSEC = "whsec_test_local_secret"; SHOTS = "/home/claude/glideinside/qa/payments/"
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
def sign(raw, t=None, secret=WHSEC, extra=()):
    t = int(t if t is not None else time.time()); v = hmac.new(secret.encode(), f"{t}.{raw}".encode(), hashlib.sha256).hexdigest()
    return f"t={t}," + ",".join([f"v1={x}" for x in extra] + [f"v1={v}"])
def post(path, body, headers=None, raw=False):
    data = body if isinstance(body, bytes) else (body.encode() if isinstance(body, str) else json.dumps(body).encode())
    req = urllib.request.Request(BASE + path, data=data, headers=headers or {}, method="POST")
    try:
        r = urllib.request.urlopen(req); return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        b = e.read(); 
        try: return e.code, json.loads(b)
        except Exception: return e.code, b
def get(path):
    try:
        r = urllib.request.urlopen(BASE + path); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"null")
def webhook(ev, **kw):
    raw = json.dumps(ev); return post("/api/stripe/webhook", raw, {"stripe-signature": sign(raw, **kw), "content-type": "application/json"})
def completed(eid, sid, pid, pi, email="buyer@example.com", amount=3500, cur="aud", status="paid", app="pocket-architect"):
    return {"id": eid, "type": "checkout.session.completed", "data": {"object": {"id": sid, "mode": "payment", "payment_status": status, "client_reference_id": pid, "metadata": {"projectId": pid, "app": app}, "payment_intent": pi, "amount_total": amount, "currency": cur, "customer_details": {"email": email}}}}
def refund(eid, pi, full=True):
    return {"id": eid, "type": "charge.refunded", "data": {"object": {"payment_intent": pi, "amount": 3500, "amount_refunded": 3500 if full else 1000, "refunded": full}}}
def db(q):
    import urllib.parse; return json.loads(urllib.request.urlopen(BASE + "/_db?q=" + urllib.parse.quote(q)).read())
def browser_ctx(p, **kw):
    b = p.chromium.launch(args=ARGS); c = b.new_context(viewport={"width": 1366, "height": 800}, **kw)
    c.route("**/fonts.googleapis.com/**", lambda r: r.abort()); c.route("**/fonts.gstatic.com/**", lambda r: r.abort()); return b, c
