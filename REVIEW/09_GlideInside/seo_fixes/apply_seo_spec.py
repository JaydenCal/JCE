"""Apply the "changes to action" SEO spec to a copy of the live Glide Inside index.html.

    python apply_seo_spec.py index.html index.seo.html

Reads the downloaded index.html, writes a NEW file (never overwrites the input), and prints a before/after of
every change. It changes the <title>, meta description, og:/twitter: title and description (if present) and the
text inside the single <h1>, keeping the <h1>'s attributes. Nothing else is touched. Stops if the page does not
have exactly one <h1> or no <title>, so nothing is guessed. Nothing is uploaded.
"""
import html, re, sys
from pathlib import Path

TITLE = "Glide Inside, 3D Floor Plans for Real Estate, Regional"
DESCRIPTION = ("3D fly-through videos and 3D floor plans for real estate agents and builders in regional Australia. "
               "$249, pay when you upload.")
H1 = "3D Floor Plans for Real Estate That Buyers Can Walk Through"
H2_REQUIRED = ["Display Home Virtual Tours and Off-the-Plan Fly-Throughs", "3D Floor Plans for Real Estate Listings"]


def main(src, dst):
    src, dst = Path(src), Path(dst)
    if dst.exists() or dst.resolve() == src.resolve():
        sys.exit("Choose a new output file name; the input and existing files are never overwritten.")
    s = src.read_text(encoding="utf-8")
    changes = []

    def sub(pattern, repl, label, required=True, flags=re.I | re.S):
        nonlocal s
        found = re.findall(pattern, s, flags)
        if required and len(found) != 1:
            sys.exit(f"Stopped: expected exactly one {label}, found {len(found)}.")
        if not found:
            return
        match = re.search(pattern, s, flags)
        after = repl(match) if callable(repl) else repl
        s = s[:match.start()] + after + s[match.end():]
        changes.append((label, match.group(0), after))

    attr = html.escape
    sub(r"<title>.*?</title>", f"<title>{attr(TITLE, quote=False)}</title>", "<title>")
    sub(r'<meta\s+name="description"\s+content="[^"]*"\s*/?>', f'<meta name="description" content="{attr(DESCRIPTION)}">', "meta description")
    for prop, value in (("og:title", TITLE), ("og:description", DESCRIPTION), ("twitter:title", TITLE), ("twitter:description", DESCRIPTION)):
        key = "property" if prop.startswith("og:") else "name"
        sub(rf'<meta\s+{key}="{prop}"\s+content="[^"]*"\s*/?>', f'<meta {key}="{prop}" content="{attr(value)}">', prop, required=False)
    sub(r"<h1(\s[^>]*)?>.*?</h1>", lambda m: f"<h1{m.group(1) or ''}>{attr(H1, quote=False)}</h1>", "<h1>")

    text = re.sub(r"<[^>]+>", " ", s)
    text = re.sub(r"\s+", " ", html.unescape(text))
    for h2 in H2_REQUIRED:
        print(("OK   " if h2 in text else "MISSING ") + "H2: " + h2)
    if len(TITLE) >= 60:
        sys.exit("Title is 60 characters or more.")

    dst.write_text(s, encoding="utf-8")
    for label, before, after in changes:
        print(f"\n[{label}]\n- {before.strip()[:300]}\n+ {after.strip()[:300]}")
    print(f"\nWrote {dst}. Upload it as index.html only after checking it in a browser.")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
