import type { Status } from "./data";
export const StatusPill = ({ s }: { s: Status }) => <span className={`pill whitespace-nowrap ${s === "Available" ? "border-brand text-gold" : "border-line text-muted"}`}>{s}</span>;
