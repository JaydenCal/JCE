export interface ScrollMetrics { scrollTop: number; clientHeight: number; scrollHeight: number }
/** True once the reader is within `tolerance` px of the bottom (or nothing to scroll). */
export function isScrolledToEnd(m: ScrollMetrics, tolerance = 8): boolean {
  return m.scrollHeight <= m.clientHeight + tolerance || m.scrollTop + m.clientHeight >= m.scrollHeight - tolerance;
}
/** Accept button enabled only after scroll-to-end AND explicit tick (never pre-ticked). */
export function canAccept(s: { scrolledToEnd: boolean; ticked: boolean; busy?: boolean }): boolean {
  return s.scrolledToEnd && s.ticked && !s.busy;
}
export function needsReacceptance(acceptedVersionId: string | null | undefined, currentVersionId: string): boolean {
  return acceptedVersionId !== currentVersionId;
}
/** Pull the "KEY RISKS SUMMARY" blockquote out of the Terms markdown. */
export function extractKeyRisks(md: string): { intro: string; items: string[]; rest: string } {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => /^>\s*#+\s*KEY RISKS SUMMARY/i.test(l));
  if (start < 0) return { intro: "", items: [], rest: md };
  let end = start; while (end < lines.length && lines[end].startsWith(">")) end++;
  const body = lines.slice(start + 1, end).map((l) => l.replace(/^>\s?/, "").trim()).filter(Boolean);
  const items = body.filter((l) => /^\d+\./.test(l)).map((l) => l.replace(/^\d+\.\s*/, ""));
  const intro = body.find((l) => !/^\d+\./.test(l)) ?? "";
  return { intro, items, rest: [...lines.slice(0, start), ...lines.slice(end)].join("\n") };
}
