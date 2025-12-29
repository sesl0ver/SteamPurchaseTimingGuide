export class DealApi {
    async fetchDeal(kind, id) {
        let url;
        if (kind === "sub") url = `/api/deal/sub/${id}`;
        else if (kind === "bundle") url = `/api/deal/bundle/${id}`;
        else url = `/api/deal/${id}`;

        const res = await fetch(url);
        const json = await res.json();
        if (!res.ok || !json?.success) {
            throw new Error(json?.message || "API 응답이 올바르지 않습니다.");
        }
        return json.data;
    }

    async fetchTrending(days = 7, limit = 10, opts = {}) {
        const url = `/api/trending?days=${encodeURIComponent(days)}&limit=${encodeURIComponent(limit)}`;
        const res = await fetch(url, { headers: { "Accept": "application/json" }, signal: opts.signal });
        const json = await res.json().catch(() => null);

        if (!res.ok || !json?.success) {
            throw new Error(json?.message || "Trending API 응답이 올바르지 않습니다.");
        }
        return json.data;
    }
}
