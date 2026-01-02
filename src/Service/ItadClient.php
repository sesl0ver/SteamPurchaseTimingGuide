<?php
declare(strict_types=1);

namespace App\Service;

use App\Infrastructure\Cache\RedisCache;
use GuzzleHttp\ClientInterface;
use GuzzleHttp\Exception\GuzzleException;

final class ItadClient
{
    private const CACHE_PREFIX = 'itad:';
    private const DEFAULT_TIMEOUT_SEC = 10;
    private const HISTORY_TREND_CACHE_SEC = 60 * 30; // 30m

    public function __construct(
        private readonly ClientInterface $http,
        private readonly RedisCache $cache,
        private readonly string $apiBase,
        private readonly string $apiKey,
        private readonly int $steamShopId = 61,
    ) {}

    /* =========================================================
     * 1) Lookup (Steam app/sub/bundle -> ITAD id)
     * ========================================================= */

    /**
     * ✅ Steam AppID -> ITAD Game UUID 조회 (캐시 포함)
     */
    public function lookupSteamAppId(string $steamAppId): ?string
    {
        $steamAppId = trim($steamAppId);
        if ($steamAppId === '' || !preg_match('/^\d+$/', $steamAppId)) {
            return null;
        }
        return $this->lookupSteamShopGameId("app/{$steamAppId}", "steam_app");
    }

    /**
     * ✅ Steam SubID -> ITAD Game UUID 조회 (캐시 포함)
     */
    public function lookupSteamSubId(string $steamSubId): ?string
    {
        $steamSubId = trim($steamSubId);
        if ($steamSubId === '' || !preg_match('/^\d+$/', $steamSubId)) {
            return null;
        }
        return $this->lookupSteamShopGameId("sub/{$steamSubId}", "steam_sub");
    }

    /**
     * ✅ Steam BundleID -> ITAD Game UUID 조회 (캐시 포함)
     *
     * - ITAD lookup endpoint가 shop game id로 "bundle/24548" 형태를 받아주는 경우 동작합니다.
     * - 만약 ITAD 쪽에서 bundle 타입을 지원하지 않는 경우 null로 떨어질 수 있습니다(그 경우 Steam 번들 API만으로 처리).
     */
    public function lookupSteamBundleId(string $steamBundleId): ?string
    {
        $steamBundleId = trim($steamBundleId);
        if ($steamBundleId === '' || !preg_match('/^\d+$/', $steamBundleId)) {
            return null;
        }
        return $this->lookupSteamShopGameId("bundle/{$steamBundleId}", "steam_bundle");
    }

    /**
     * 공통: shop game id(app/xxx, sub/xxx, bundle/xxx) -> ITAD UUID
     */
    private function lookupSteamShopGameId(string $shopGameId, string $cacheScope): ?string
    {
        $shopGameId = trim($shopGameId);
        if ($shopGameId === '' || !preg_match('~^(app|sub|bundle)/\d+$~', $shopGameId)) {
            return null;
        }

        $cacheKey = self::CACHE_PREFIX . "map:{$cacheScope}:{$shopGameId}";
        $cached = $this->cacheGetString($cacheKey);
        if ($cached !== null) {
            return ($cached === '__null__') ? null : $cached;
        }

        try {
            $res = $this->http->request(
                'POST',
                "{$this->apiBase}/lookup/id/shop/{$this->steamShopId}/v1",
                [
                    'headers' => $this->headers(),
                    'json' => [$shopGameId],
                    'timeout' => self::DEFAULT_TIMEOUT_SEC,
                ]
            );

            $data = json_decode((string)$res->getBody(), true);
            $itadId = is_array($data) ? ($data[$shopGameId] ?? null) : null;

            $this->cacheSetString(
                $cacheKey,
                (is_string($itadId) && $itadId !== '') ? $itadId : '__null__',
                60 * 60 * 24 * 30
            );

            return (is_string($itadId) && $itadId !== '') ? $itadId : null;
        } catch (GuzzleException) {
            // 실패 시에도 단기 negative cache로 연속 실패 방지
            $this->cacheSetString($cacheKey, '__null__', 60 * 60);
            return null;
        }
    }

    /* =========================================================
     * 2) Overview (Current + Lowest 포함 가능)
     * ========================================================= */

    /**
     * ITAD Game UUID -> Overview 조회
     *
     * - "v2 body 방식" 우선 시도
     * - 실패하면 "legacy query 방식" fallback
     */
    public function getOverview(string $itadGameId, string $country = 'KR'): ?array
    {
        $itadGameId = trim($itadGameId);
        if ($itadGameId === '') {
            return null;
        }

        $country = strtoupper(trim($country)) ?: 'KR';

        $cacheKey = self::CACHE_PREFIX . "overview:{$country}:{$itadGameId}";
        $cached = $this->cacheGetJson($cacheKey);
        if ($cached !== null) {
            return ($cached === '__null__') ? null : $cached;
        }

        // 1) v2 body 방식
        $overview = $this->tryOverviewV2Body($itadGameId, $country);

        // 2) fallback: legacy query 방식
        if ($overview === null) {
            $overview = $this->tryOverviewLegacyQuery($itadGameId, $country);
        }

        // overview는 자주 바뀔 수 있으니 15m (필요하면 1h까지 늘려도 됨)
        $this->cacheSetJson(
            $cacheKey,
            $overview ?? '__null__',
            60 * 15
        );

        return $overview;
    }

    private function tryOverviewV2Body(string $itadGameId, string $country): ?array
    {
        try {
            $res = $this->http->request(
                'POST',
                "{$this->apiBase}/games/overview/v2",
                [
                    'headers' => $this->headers(),
                    'json' => [
                        'ids' => [$itadGameId],
                        'country' => $country,
                        'shops' => [$this->steamShopId],
                    ],
                    'timeout' => self::DEFAULT_TIMEOUT_SEC,
                ]
            );

            $data = json_decode((string)$res->getBody(), true);
            return $this->extractOverview($data, $itadGameId);
        } catch (GuzzleException) {
            return null;
        }
    }

    private function tryOverviewLegacyQuery(string $itadGameId, string $country): ?array
    {
        try {
            $res = $this->http->request(
                'POST',
                "{$this->apiBase}/games/overview/v2",
                [
                    'headers' => $this->headersWithoutAuth(),
                    'query' => [
                        'country' => $country,
                        'shops' => $this->steamShopId,
                        'key' => $this->apiKey,
                    ],
                    'json' => [$itadGameId],
                    'timeout' => self::DEFAULT_TIMEOUT_SEC,
                ]
            );

            $data = json_decode((string)$res->getBody(), true);
            return $this->extractOverview($data, $itadGameId);
        } catch (GuzzleException) {
            return null;
        }
    }

    private function extractOverview(array $data, string $itadGameId): ?array
    {
        // 형태 A) { prices: [ {id, current, lowest, ...}, ... ] }
        if (!isset($data['prices']) || !is_array($data['prices'])) {
            return null;
        }

        foreach ($data['prices'] as $row) {
            if (is_array($row) && ($row['id'] ?? null) === $itadGameId) {
                return $row;
            }
        }
        return null;
    }

    /**
     * ✅ 스토어(shops) 기준의 최저가 동향(all/y1/m3)을 응답용으로 정규화
     *
     * IMPORTANT
     * - Prices v3의 historyLow는 "전체 스토어(ITAD 커버 범위)" 기준으로 내려올 수 있습니다.
     *   (overview/v2 문서에도 historical low는 "among all covered shops"라고 명시)
     * - 따라서 여기서는 아래 방식으로 "선택된 shops" 기준 트렌드를 만듭니다.
     *   - all: /games/storelow/v2 (선택 shops의 storeLow)
     *   - y1/m3: /games/history/v2 + since 필터로 로그를 받아 최소값 계산
     *
     * 실패 시 null
     */
    public function getHistoryLowTrend(
        string $itadGameId,
        string $country = 'KR',
        ?array $shopIds = null
    ): ?array {
        $itadGameId = trim($itadGameId);
        if ($itadGameId === '') {
            return null;
        }

        $country = strtoupper(trim($country)) ?: 'KR';
        $shopIds = $this->normalizeShopIds($shopIds);

        $shopsKey = implode(',', $shopIds);
        $cacheKey = self::CACHE_PREFIX . "historytrend:{$country}:{$shopsKey}:{$itadGameId}";
        $cached = $this->cacheGetJson($cacheKey);
        if ($cached !== null) {
            return ($cached === '__null__') ? null : $cached;
        }

        $all = $this->getStoreLowPrice($itadGameId, $country, $shopIds);

        // y1/m3는 history log에서 계산
        $now = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $sinceY1 = $now->sub(new \DateInterval('P1Y'))->format(DATE_ATOM);
        $sinceM3 = $now->sub(new \DateInterval('P3M'))->format(DATE_ATOM);

        $y1 = $this->getLowestFromHistory($itadGameId, $country, $shopIds, $sinceY1);
        $m3 = $this->getLowestFromHistory($itadGameId, $country, $shopIds, $sinceM3);

        // 통화는 all -> y1 -> m3 순으로 추정
        $currency = $all['currency'] ?? ($y1['currency'] ?? ($m3['currency'] ?? null));

        $result = [
            'all' => $all,
            'y1'  => $y1,
            'm3'  => $m3,
            'currency' => $currency,
            'shops' => $shopIds,
            'source' => 'storelow+history_v2',
        ];

        // 30m 캐시
        $this->cacheSetJson($cacheKey, $result, self::HISTORY_TREND_CACHE_SEC);
        return $result;
    }

    /* =========================================================
     * 3.1) Store-specific historical low helpers
     * ========================================================= */

    /**
     * shops 파라미터 정규화
     * - null이면 기본(steamShopId)
     * - 빈 배열이면 기본(steamShopId)
     * - 중복/비정상 값 제거
     */
    private function normalizeShopIds(?array $shopIds): array
    {
        if (!is_array($shopIds) || $shopIds === []) {
            return [$this->steamShopId];
        }

        $out = [];
        foreach ($shopIds as $id) {
            if (is_int($id) && $id > 0) {
                $out[] = $id;
            } elseif (is_string($id) && preg_match('/^\d+$/', $id)) {
                $out[] = (int)$id;
            }
        }

        $out = array_values(array_unique($out));
        return $out !== [] ? $out : [$this->steamShopId];
    }

    /**
     * /games/storelow/v2 에서 선택 shops의 all-time storeLow를 가져옴
     * - 성공 시 price 객체( amount/amountInt/currency ) 반환
     */
    private function getStoreLowPrice(string $itadGameId, string $country, array $shopIds): ?array
    {
        $data = $this->getStoreLow($itadGameId, $country, $shopIds);
        if (!is_array($data)) {
            return null;
        }

        // 응답은 [ {id, lows:[{shop, price, ...}, ...]}, ... ] 형태로 문서화되어 있음
        $row = null;
        if (isset($data[0]) && is_array($data[0])) {
            foreach ($data as $r) {
                if (is_array($r) && (string)($r['id'] ?? '') === $itadGameId) {
                    $row = $r;
                    break;
                }
            }
            $row ??= $data[0];
        } elseif (isset($data['id']) && (string)$data['id'] === $itadGameId) {
            $row = $data;
        }

        if (!is_array($row)) {
            return null;
        }

        $lows = $row['lows'] ?? null;
        if (!is_array($lows)) {
            return null;
        }

        // 요청한 shops 중에서 첫 번째 일치하는 항목의 price 반환
        foreach ($lows as $low) {
            $shopId = $low['shop']['id'] ?? null;
            if (is_int($shopId) && in_array($shopId, $shopIds, true)) {
                $price = $low['price'] ?? null;
                return is_array($price) ? $price : null;
            }
        }

        return null;
    }

    /**
     * /games/history/v2 에서 since 이후 로그를 가져와 최저 price를 계산
     * - 반환: price 객체( amount/amountInt/currency )
     */
    private function getLowestFromHistory(string $itadGameId, string $country, array $shopIds, string $sinceIso): ?array
    {
        $rows = $this->getHistoryLog($itadGameId, $country, $shopIds, $sinceIso);
        if (!is_array($rows) || $rows === []) {
            return null;
        }

        $best = null;
        $bestInt = null;

        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
            $deal = $row['deal'] ?? null;
            if (!is_array($deal)) {
                continue;
            }
            $price = $deal['price'] ?? null;
            if (!is_array($price)) {
                continue;
            }

            $amountInt = $price['amountInt'] ?? null;
            if (!is_int($amountInt)) {
                // amountInt가 없으면 amount로 대체 (정밀도는 떨어질 수 있음)
                $amount = $price['amount'] ?? null;
                if (is_numeric($amount)) {
                    $amountInt = (int)round(((float)$amount) * 100);
                } else {
                    continue;
                }
            }

            if ($bestInt === null || $amountInt < $bestInt) {
                $bestInt = $amountInt;
                $best = $price;
            }
        }

        return $best;
    }

    /**
     * Store Low API
     * POST /games/storelow/v2
     * - query: country, shops
     * - body: ["<uuid>"]
     */
    private function getStoreLow(string $itadGameId, string $country, array $shopIds): ?array
    {
        $shopsCsv = implode(',', $shopIds);

        // Bearer 우선
        try {
            $res = $this->http->request(
                'POST',
                "{$this->apiBase}/games/storelow/v2",
                [
                    'headers' => $this->headers(),
                    'query' => [
                        'country' => $country,
                        'shops' => $shopsCsv,
                    ],
                    'json' => [$itadGameId],
                    'timeout' => self::DEFAULT_TIMEOUT_SEC,
                ]
            );
            return json_decode((string)$res->getBody(), true);
        } catch (GuzzleException) {
            // fallback
        }

        try {
            $res = $this->http->request(
                'POST',
                "{$this->apiBase}/games/storelow/v2",
                [
                    'headers' => $this->headersWithoutAuth(),
                    'query' => [
                        'country' => $country,
                        'shops' => $shopsCsv,
                        'key' => $this->apiKey,
                    ],
                    'json' => [$itadGameId],
                    'timeout' => self::DEFAULT_TIMEOUT_SEC,
                ]
            );
            return json_decode((string)$res->getBody(), true);
        } catch (GuzzleException) {
            return null;
        }
    }

    /**
     * History Log API
     * GET /games/history/v2
     * - query: id, country, shops, since
     */
    private function getHistoryLog(string $itadGameId, string $country, array $shopIds, string $sinceIso): ?array
    {
        $shopsCsv = implode(',', $shopIds);

        // Bearer 우선
        try {
            $res = $this->http->request(
                'GET',
                "{$this->apiBase}/games/history/v2",
                [
                    'headers' => $this->headers(),
                    'query' => [
                        'id' => $itadGameId,
                        'country' => $country,
                        'shops' => $shopsCsv,
                        'since' => $sinceIso,
                    ],
                    'timeout' => self::DEFAULT_TIMEOUT_SEC,
                ]
            );
            return json_decode((string)$res->getBody(), true);
        } catch (GuzzleException) {
            // fallback
        }

        try {
            $res = $this->http->request(
                'GET',
                "{$this->apiBase}/games/history/v2",
                [
                    'headers' => $this->headersWithoutAuth(),
                    'query' => [
                        'id' => $itadGameId,
                        'country' => $country,
                        'shops' => $shopsCsv,
                        'since' => $sinceIso,
                        'key' => $this->apiKey,
                    ],
                    'timeout' => self::DEFAULT_TIMEOUT_SEC,
                ]
            );
            return json_decode((string)$res->getBody(), true);
        } catch (GuzzleException) {
            return null;
        }
    }

    /* =========================================================
     * 4) Convenience wrappers (호환/신규)
     * ========================================================= */

    /**
     * ✅ (기존 호환) Steam AppID -> [itadId, overview]
     * - SteamDealHelper의 app 흐름이 의존하고 있으므로 유지
     */
    public function getOverviewBySteamAppId(string $steamAppId, string $country = 'KR'): array
    {
        $itadId = $this->lookupSteamAppId($steamAppId);

        return [
            'itadId' => $itadId,
            'overview' => $itadId ? $this->getOverview($itadId, $country) : null,
        ];
    }

    /**
     * ✅ (신규) Steam SubID -> [itadId, overview, history_low]
     */
    public function getDealBySteamSubId(string $steamSubId, string $country = 'KR'): array
    {
        $itadId = $this->lookupSteamSubId($steamSubId);

        return [
            'itadId' => $itadId,
            'overview' => $itadId ? $this->getOverview($itadId, $country) : null,
            'history_low_trend' => $itadId ? $this->getHistoryLowTrend($itadId, $country) : null,
        ];
    }

    /**
     * ✅ (신규) Steam BundleID -> [itadId, overview, history_low]
     *
     * - ITAD overview가 current/lowest를 포함하는 경우가 있어,
     *   bundle도 sub/app과 동일하게 deal 스키마를 구성할 수 있습니다.
     */
    public function getDealBySteamBundleId(string $steamBundleId, string $country = 'KR'): array
    {
        $itadId = $this->lookupSteamBundleId($steamBundleId);

        return [
            'itadId' => $itadId,
            'overview' => $itadId ? $this->getOverview($itadId, $country) : null,
            'history_low_trend' => $itadId ? $this->getHistoryLowTrend($itadId, $country) : null,
        ];
    }

    /**
     * ✅ (선택) bundle에서 overview만 필요한 경우
     */
    public function getOverviewBySteamBundleId(string $steamBundleId, string $country = 'KR'): array
    {
        $itadId = $this->lookupSteamBundleId($steamBundleId);

        return [
            'itadId' => $itadId,
            'overview' => $itadId ? $this->getOverview($itadId, $country) : null,
        ];
    }

    /* =========================================================
     * Headers / Cache helpers
     * ========================================================= */

    /**
     * Bearer 인증
     */
    private function headers(): array
    {
        return [
            'Accept' => 'application/json',
            'Content-Type' => 'application/json',
            'Authorization' => 'Bearer ' . $this->apiKey,
        ];
    }

    /**
     * legacy query fallback용 (Authorization 제거)
     */
    private function headersWithoutAuth(): array
    {
        return [
            'Accept' => 'application/json',
            'Content-Type' => 'application/json',
        ];
    }

    /* ===== Cache helpers ===== */

    private function cacheGetString(string $key): ?string
    {
        $val = $this->cache->get($key);
        if ($val === null || $val === false) {
            return null;
        }
        return is_string($val) ? $val : null;
    }

    private function cacheSetString(string $key, string $value, int $ttlSec): void
    {
        $this->cache->set($key, $value, $ttlSec);
    }

    private function cacheGetJson(string $key): array|string|null
    {
        $raw = $this->cacheGetString($key);
        if ($raw === null) {
            return null;
        }
        if ($raw === '__null__') {
            return '__null__';
        }

        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : null;
    }

    private function cacheSetJson(string $key, array|string $value, int $ttlSec): void
    {
        if ($value === '__null__') {
            $this->cacheSetString($key, '__null__', $ttlSec);
            return;
        }

        $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json !== false) {
            $this->cacheSetString($key, $json, $ttlSec);
        }
    }
}
