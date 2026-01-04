export class DealApi {
    constructor() {
        // key -> { data, expiresAt }
        this._cache = new Map();

        // key -> Promise (중복 호출 방지)
        this._inFlight = new Map();

        // 기본 캐시 유지 시간 (60초)
        this._ttlMs = 60_000;
    }

    _key(kind, id) {
        return `${kind}:${id}`;
    }

    _url(kind, id) {
        if (kind === "sub") return `/api/deal/sub/${id}`;
        if (kind === "bundle") return `/api/deal/bundle/${id}`;
        return `/api/deal/${id}`;
    }

    _getCached(key) {
        const entry = this._cache.get(key);
        if (!entry) return null;

        // 만료되었으면 제거
        if (Date.now() > entry.expiresAt) {
            this._cache.delete(key);
            return null;
        }
        return entry.data;
    }

    /**
     * 공통 요청 핸들러 (캐시 + 중복 호출 방지)
     */
    async _request(key, url, opts = {}, ttlMs = this._ttlMs) {
        const force = opts.force === true;

        if (!force) {
            const cached = this._getCached(key);
            if (cached) return cached;
        }

        if (!force && this._inFlight.has(key)) {
            return this._inFlight.get(key);
        }

        const p = (async () => {
            const res = await fetch(url, {
                headers: { "Accept": "application/json" },
                signal: opts.signal
            });

            if (res.status === 401) {
                throw new Error("401");
            }

            const json = await res.json().catch(() => null);

            if (!res.ok || !json?.success) {
                throw new Error(json?.message || "API 응답이 올바르지 않습니다.");
            }

            if (ttlMs > 0) {
                this._cache.set(key, {
                    data: json.data,
                    expiresAt: Date.now() + ttlMs
                });
            }

            return json.data;
        })();

        this._inFlight.set(key, p);

        try {
            return await p;
        } finally {
            this._inFlight.delete(key);
        }
    }

    /**
     * @param {"app"|"sub"|"bundle"} kind
     * @param {string|number} id
     * @param {{ force?: boolean }} opts
     */
    async fetchDeal(kind, id, opts = {}) {
        const key = this._key(kind, id);
        const url = this._url(kind, id);
        return this._request(key, url, opts, this._ttlMs);
    }

    /**
     * (선택) 특정 항목만 무효화
     */
    invalidateDeal(kind, id) {
        this._cache.delete(this._key(kind, id));
    }

    /**
     * (선택) 전체 캐시 비우기
     */
    clearDealCache() {
        this._cache.clear();
    }

    async fetchRecent(opts = {}) {
        const limit = opts.limit || 10;
        const url = `/api/recent-lookups?limit=${encodeURIComponent(limit)}`;
        // Recent lookups는 캐시하지 않음 (매번 최신 상태 필요)
        return this._request(`recent:${limit}`, url, opts, 0);
    }

    /**
     * Steam Store Search (server proxy)
     * @param {string} term
     * @param {{ force?: boolean, signal?: AbortSignal }} opts
     */
    async storeSearch(term, opts = {}) {
        const q = String(term || "").trim();
        if (!q) {
            return { total: 0, items: [] };
        }

        const key = `search:${q.toLowerCase()}`;
        const url = `/api/storesearch?term=${encodeURIComponent(q)}`;
        // 검색 결과는 짧게 캐시(15초)
        return this._request(key, url, opts, 15_000);
    }

    /**
     * Wishlist 목록 (로그인 필요)
     * GET /api/wishlist/list
     */
    async wishlistList(opts = {}) {
        const key = "wishlist:list";
        const url = "/api/wishlist/list";
        // 찜 목록은 짧게 캐시(15초)
        return this._request(key, url, opts, 15_000);
    }
}
