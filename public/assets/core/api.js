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
}
