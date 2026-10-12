import React from "react";
const inline = (t: string): React.ReactNode[] =>
  t.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).map((p, i) =>
    p.startsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p.startsWith("`") ? <code key={i} className="rounded bg-subtle px-1">{p.slice(1, -1)}</code> : p.startsWith("*") && p.length > 2 ? <em key={i}>{p.slice(1, -1)}</em> : p);
/** Minimal markdown renderer (headings, paragraphs, lists, quotes, tables) for the Terms text. */
export function Markdown({ md }: { md: string }) {
  const out: React.ReactNode[] = []; const L = md.split("\n"); let i = 0, k = 0;
  while (i < L.length) {
    const l = L[i];
    if (!l.trim() || /^---+$/.test(l.trim())) { i++; continue; }
    const h = /^(#{1,4})\s+(.*)/.exec(l);
    if (h) { const T = (`h${Math.min(h[1].length + 0, 3)}`) as "h1"; out.push(<T key={k++}>{inline(h[2])}</T>); i++; continue; }
    if (l.startsWith("|")) { const rows: string[][] = []; while (i < L.length && L[i].startsWith("|")) { if (!/^\|[\s|:-]+\|?$/.test(L[i])) rows.push(L[i].split("|").slice(1, -1).map((c) => c.trim())); i++; }
      out.push(<table key={k++}><tbody>{rows.map((r, a) => <tr key={a}>{r.map((c, b) => a === 0 ? <th key={b}>{inline(c)}</th> : <td key={b}>{inline(c)}</td>)}</tr>)}</tbody></table>); continue; }
    if (l.startsWith(">")) { const q: string[] = []; while (i < L.length && L[i].startsWith(">")) q.push(L[i++].replace(/^>\s?/, "")); out.push(<blockquote key={k++}>{inline(q.join(" "))}</blockquote>); continue; }
    if (/^\s*[-*]\s/.test(l)) { const it: string[] = []; while (i < L.length && /^\s*[-*]\s/.test(L[i])) it.push(L[i++].replace(/^\s*[-*]\s/, "")); out.push(<ul key={k++}>{it.map((x, a) => <li key={a}>{inline(x)}</li>)}</ul>); continue; }
    const p: string[] = []; while (i < L.length && L[i].trim() && !/^(#|>|\||\s*[-*]\s)/.test(L[i])) p.push(L[i++]); out.push(<p key={k++}>{inline(p.join(" "))}</p>);
  }
  return <div className="prose-terms">{out}</div>;
}
