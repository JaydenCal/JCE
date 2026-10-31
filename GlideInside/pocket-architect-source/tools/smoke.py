#!/usr/bin/env python3
"""Headless smoke test for Plan Studio pages.

Serves the project root on a free local port, opens a page in Chromium with
SwiftShader WebGL, runs optional JavaScript steps, saves a screenshot and
reports console errors, page errors and failed requests.

Usage:
  python3 tools/smoke.py [path] [--out shot.png] [--wait 2500] [--size 1440x900]
                         [--dark] [--eval "js expression or () => {...}"]...

Each --eval runs in order after load and is followed by --wait ms.
Exit code 1 when any error was captured.
"""
import argparse
import asyncio
import functools
import http.server
import os
import socketserver
import sys
import threading

from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args, **kwargs):
        pass


def serve():
    handler = functools.partial(Quiet, directory=ROOT)
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", nargs="?", default="index.html")
    ap.add_argument("--out", default=None)
    ap.add_argument("--wait", type=int, default=2500)
    ap.add_argument("--eval", action="append", default=[])
    ap.add_argument("--size", default="1440x900")
    ap.add_argument("--dark", action="store_true")
    a = ap.parse_args()

    httpd = serve()
    port = httpd.server_address[1]
    width, height = map(int, a.size.lower().split("x"))
    errors = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
        )
        ctx = await browser.new_context(
            viewport={"width": width, "height": height},
            color_scheme="dark" if a.dark else "light",
        )
        page = await ctx.new_page()

        def on_console(m):
            if m.type == "error":
                errors.append(f"console.error: {m.text}")
            elif m.type == "warning":
                print(f"[warning] {m.text}")

        page.on("console", on_console)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on(
            "requestfailed",
            lambda r: None if "fonts.g" in r.url else errors.append(f"requestfailed: {r.url} {r.failure}"),
        )

        url = f"http://127.0.0.1:{port}/{a.path.lstrip('/')}"
        await page.goto(url, wait_until="load")
        await page.wait_for_timeout(a.wait)
        for js in a.eval:
            try:
                res = await page.evaluate(js)
                if res is not None:
                    print("eval:", res)
            except Exception as e:  # noqa: BLE001
                errors.append(f"eval error: {e}")
            await page.wait_for_timeout(a.wait)
        if a.out:
            await page.screenshot(path=a.out)
            print("screenshot:", a.out)
        await browser.close()

    httpd.shutdown()
    for e in errors:
        print("ERROR", e)
    print("OK" if not errors else f"{len(errors)} error(s)")
    sys.exit(1 if errors else 0)


asyncio.run(main())
