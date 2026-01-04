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
     * @param {"app"|"sub"|"bundle"} kind
     * @param {string|number} id
     * @param {{ force?: boolean }} opts
     */
    async fetchDeal(kind, id, opts = {}) {
        const key = this._key(kind, id);
        const force = opts.force === true;

        // 1) TTL 내 캐시가 있으면 바로 반환
        if (!force) {
            const cached = this._getCached(key);
            if (cached) return cached;
        }

        // 2) 동일 요청이 이미 진행 중이면 Promise 공유
        if (!force && this._inFlight.has(key)) {
            return this._inFlight.get(key);
        }

        const url = this._url(kind, id);

        const p = (async () => {
            const res = await fetch(url, {
                headers: { "Accept": "application/json" }
            });
            const json = await res.json().catch(() => null);

            if (!res.ok || !json?.success) {
                throw new Error(json?.message || "API 응답이 올바르지 않습니다.");
            }

            // 성공 시 TTL 캐시에 저장
            this._cache.set(key, {
                data: json.data,
                expiresAt: Date.now() + this._ttlMs
            });

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

    async fetchTrending(days = 7, limit = 10, opts = {}) {
        const url = `/api/trending?days=${encodeURIComponent(days)}&limit=${encodeURIComponent(limit)}`;
        const res = await fetch(url, {
            headers: { "Accept": "application/json" },
            signal: opts.signal
        });
        const json = await res.json().catch(() => null);

        if (!res.ok || !json?.success) {
            throw new Error(json?.message || "Trending API 응답이 올바르지 않습니다.");
        }
        return json.data;
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
        const force = opts.force === true;

        // 검색 결과는 짧게 캐시(15초)
        const prevTtl = this._ttlMs;
        this._ttlMs = 15_000;

        try {
            if (!force) {
                const cached = this._getCached(key);
                if (cached) return cached;
            }

            if (!force && this._inFlight.has(key)) {
                return this._inFlight.get(key);
            }

            const url = `/api/storesearch?term=${encodeURIComponent(q)}`;

            const p = (async () => {
                const res = await fetch(url, {
                    headers: { "Accept": "application/json" },
                    signal: opts.signal
                });
                const json = await res.json().catch(() => null);

                if (!res.ok || !json?.success) {
                    throw new Error(json?.message || "Search API 응답이 올바르지 않습니다.");
                }

                this._cache.set(key, {
                    data: json.data,
                    expiresAt: Date.now() + this._ttlMs
                });
                return json.data;
            })();

            this._inFlight.set(key, p);
            try {
                return await p;
            } finally {
                this._inFlight.delete(key);
            }
        } finally {
            // TTL 복원
            this._ttlMs = prevTtl;
        }
    }

    /**
     * Wishlist 목록 (로그인 필요)
     * GET /api/wishlist/list
     */
    async wishlistList(opts = {}) {
        const key = "wishlist:list";
        const force = opts.force === true;

        // 찜 목록은 짧게 캐시(15초)
        const prevTtl = this._ttlMs;
        this._ttlMs = 15_000;

        try {
            if (!force) {
                const cached = this._getCached(key);
                if (cached) return cached;
            }

            if (!force && this._inFlight.has(key)) {
                return this._inFlight.get(key);
            }

            const p = (async () => {
                const res = await fetch("/api/wishlist/list", {
                    headers: { "Accept": "application/json" },
                    signal: opts.signal
                });
                const json = await res.json().catch(() => null);

                if (res.status === 401) {
                    throw new Error("401");
                }

                if (!res.ok || !json?.success) {
                    throw new Error(json?.message || "Wishlist API 응답이 올바르지 않습니다.");
                }

                this._cache.set(key, {
                    data: json.data,
                    expiresAt: Date.now() + this._ttlMs
                });
                return json.data;
            })();

            this._inFlight.set(key, p);
            try {
                return await p;
            } finally {
                this._inFlight.delete(key);
            }
        } finally {
            this._ttlMs = prevTtl;
        }
    }
}
