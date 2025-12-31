export function escapeHtml(s) {
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

export function escapeHtmlWithBreaks(s) {
    return escapeHtml(s).replace(/\r\n|\n|\r/g, "<br>");
}

export function decodeHtmlEntities(str) {
    return String(str)
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&#039;", "'")
        .replaceAll("&amp;", "&");
}

export function stripHtml(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = String(html || "");
    return tmp.textContent || tmp.innerText || "";
}

export function truncateText(s, max = 70) {
    const t = String(s ?? "").trim();
    if (!t) return "";
    if (t.length <= max) return t;
    return t.slice(0, max - 1) + "…";
}

export function clamp(n, a, b) {
    const x = Number(n);
    if (!Number.isFinite(x)) return null;
    return Math.min(b, Math.max(a, x));
}

export function formatPrice(amount, currency = "KRW") {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) return "—";
    if (n === 0) return "0 " + currency;
    return new Intl.NumberFormat("ko-KR").format(n) + " " + currency;
}

export function formatDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("ko-KR");
}

export function parseKrwTextToNumber(text) {
    const m = String(text || "").match(/₩\s*([\d,]+)/);
    if (m?.[1]) return Number(m[1].replaceAll(",", ""));
    const m2 = String(text || "").match(/([\d,]{3,})/);
    if (m2?.[1]) return Number(m2[1].replaceAll(",", ""));
    return null;
}

export function sanitizeNarrativeHtml(input) {
    const escaped = escapeHtml(String(input ?? ""));
    // strong만 허용 복원
    return escaped.replace(/&lt;(\/?strong)&gt;/gi, "<$1>");
}

export function steamStoreUrl(kind, id) {
    const enc = encodeURIComponent(id);
    if (kind === "sub") return `https://store.steampowered.com/sub/${enc}/`;
    if (kind === "bundle") return `https://store.steampowered.com/bundle/${enc}/`;
    return `https://store.steampowered.com/app/${enc}/`;
}

export function parseSteamInput(input) {
    if (!input) return null;
    const raw = input.trim();

    let m = raw.match(/store\.steampowered\.com\/(app|sub|bundle)\/(\d+)/i);
    if (m?.[1] && m?.[2]) return { kind: m[1].toLowerCase(), id: m[2] };

    m = raw.match(/^(?:https?:\/\/)?\/?(app|sub|bundle)\/(\d+)/i);
    if (m?.[1] && m?.[2]) return { kind: m[1].toLowerCase(), id: m[2] };

    if (/^\d+$/.test(raw)) return { kind: "app", id: raw };

    return null;
}

export function humanizeAgo(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;

    const now = new Date();
    const diffMs = now - d;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return null;
    if (diffDays <= 1) return "최근";
    if (diffDays < 30) return `${diffDays}일 전`;

    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `${diffMonths}달 전`;

    const diffYears = Math.floor(diffMonths / 12);
    return `${diffYears}년 전`;
}

export function isNumeric (value) {
    return typeof value === "number" && Number.isFinite(value);
}