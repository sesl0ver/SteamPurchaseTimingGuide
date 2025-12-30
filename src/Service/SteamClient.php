<?php
declare(strict_types=1);

namespace App\Service;

use App\Infrastructure\Cache\RedisCache;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\GuzzleException;
use RuntimeException;

final class SteamClient
{
    /**
     * store.steampowered.com: There's a limit to 300 store requests per 5 mins.
     * → 캐시를 넉넉히(기본 1h) 잡아 “반복 조회”를 Redis가 흡수하도록 설계합니다.
     *
     * ※ TTL은 운영 트래픽에 맞게 더 늘려도 됩니다(예: 2~6시간).
     */
    private const int TTL_APPDATA          = 3600; // 1h
    private const int TTL_REVIEWS          = 1800; // 30m (리뷰 변동 가능)
    private const int TTL_SUBDETAILS       = 3600; // 1h
    private const int TTL_BUNDLE_RESOLVE   = 3600; // 1h
    private const int TTL_DLC_FOR_APP      = 3600; // 1h
    private const int TTL_NEGATIVE         = 600;  // 10m (없는 ID 반복 호출 방지)

    private Client $http;
    private string $steamBaseUrl = 'https://store.steampowered.com';

    public function __construct(
        private readonly RedisCache $cache,
        ?Client $http = null
    ) {
        // 기존 동작 유지 + 외부에서 주입 가능
        $this->http = $http ?? new Client(['timeout' => 30]);
    }

    /* =========================================================
     * Low-level request helpers
     * ========================================================= */

    private function requestJson(string $method, string $url, array $options = []): array
    {
        try {
            $response = $this->http->request($method, $url, $options + [
                    'timeout' => 15.0,
                    'connect_timeout' => 5.0,
                    'http_errors' => false,
                    'headers' => [
                        'Accept' => 'application/json',
                    ],
                ]);

            $status = $response->getStatusCode();
            $raw = (string)$response->getBody();

            if ($status >= 400) {
                throw new RuntimeException("Steam Store API HTTP {$status}: {$raw}");
            }

            $json = json_decode($raw, true);
            if (!is_array($json)) {
                throw new RuntimeException('Invalid JSON response from Steam Store API');
            }

            return $json;
        } catch (GuzzleException $e) {
            throw new RuntimeException(
                "Steam Store API request failed: {$e->getMessage()}",
                0,
                $e
            );
        }
    }

    private function requestText(string $method, string $url, array $options = []): string
    {
        try {
            $response = $this->http->request($method, $url, $options + [
                    'timeout' => 15.0,
                    'connect_timeout' => 5.0,
                    'http_errors' => false,
                    'headers' => [
                        'Accept' => 'application/json',
                    ],
                ]);

            $status = $response->getStatusCode();
            $raw = (string)$response->getBody();

            if ($status >= 400) {
                throw new RuntimeException("Steam Store API HTTP {$status}: {$raw}");
            }

            return $raw;
        } catch (GuzzleException $e) {
            throw new RuntimeException(
                "Steam Store API request failed: {$e->getMessage()}",
                0,
                $e
            );
        }
    }

    private function normalizeCountry(string $country): string
    {
        $c = strtoupper(trim($country));
        return $c !== '' ? $c : 'KR';
    }

    /* =========================================================
     * 1) App details (store api/appdetails)
     * ========================================================= */

    public function getAppData(string|int $appId, string $country = 'KR'): array
    {
        $appId = (string)$appId;
        if ($appId === '' || !preg_match('/^\d+$/', $appId)) {
            return ['success' => false];
        }

        $country = $this->normalizeCountry($country);
        $cacheKey = "steam:store:app:v1:{$country}:{$appId}";

        // 1) 캐시 히트
        $cached = $this->cache->getJson($cacheKey);
        if (is_array($cached) && ($cached['success'] ?? null) === true) {
            return $cached;
        }

        // 2) 미스 -> API 호출 (실패 시 캐시 fallback)
        try {
            $queryString = http_build_query([
                'appids'  => $appId,
                'l'       => 'koreana',
                'cc'      => strtolower($country),
                'filters' => 'basic,genres,price_overview,release_date,packages,package_groups,supported_languages,achievements'
            ]);

            $result = $this->requestJson('GET', $this->steamBaseUrl . '/api/appdetails?' . $queryString);

            if (
                empty($result[$appId]) ||
                empty($result[$appId]['success']) ||
                empty($result[$appId]['data'])
            ) {
                $fail = ['success' => false];
                $this->cache->setJson($cacheKey, self::TTL_NEGATIVE, $fail);
                return $fail;
            }

            $data = $result[$appId]['data'];
            $po = (isset($data['price_overview']) && is_array($data['price_overview'])) ? $data['price_overview'] : null;

            // Steam price_overview는 cents 단위(통화별 다를 수 있으나 KRW는 통상 100배)
            // 기존 코드와 호환을 위해 /100 유지
            $s = strip_tags($data['supported_languages']);
            $s = $s ? trim($s) : null;

            if ($s) {
                // 설명 문구 제거 (한/영)
                $clean = preg_replace(
                    '~\*\s*(음성이\s*지원되는\s*언어|languages?\s+with\s+full\s+audio\s+support)\s*$~iu',
                    '',
                    $s
                );

                $supported_languages = preg_match('~한국어\s*\*(\s*,|$)~u', $clean) ? 2 : (preg_match('~한국어(\s*,|$)~u', $clean) ? 1 : 0);
            } else {
                $supported_languages = 0;
            }

            $payload = [
                'success' => true,
                'name' => (string)($data['name'] ?? ''),
                'header_image' => (string)($data['header_image'] ?? ''),
                'genres' => $data['genres'] ?? null,
                'achievements' => $data['achievements'] ?? null,
                'supported_languages' => $supported_languages,
                'price' => [
                    'regular_price'    => $po !== null ? (int)($po['initial'] / 100) : 0,
                    'discount_price'   => $po !== null ? (int)($po['final'] / 100)   : 0,
                    'discount_percent' => $po !== null ? (int)($po['discount_percent']) : 0
                ],
                'release_date' => $data['release_date'] ?? null,
                'packages' => $data['packages'] ?? null,
                'package_groups' => $data['package_groups'] ?? null,
            ];

            $this->cache->setJson($cacheKey, self::TTL_APPDATA, $payload);
            return $payload;
        } catch (\Throwable $e) {
            if (is_array($cached)) return $cached;
            throw $e;
        }
    }

    /* =========================================================
     * 2) Reviews (store appreviews)
     * ========================================================= */

    public function getReviews(string|int $appId): array
    {
        $appId = (string)$appId;
        if ($appId === '' || !preg_match('/^\d+$/', $appId)) {
            return ['success' => false];
        }

        $cacheKey = "steam:store:reviews:v1:{$appId}";

        // 1) 캐시 히트
        $cached = $this->cache->getJson($cacheKey);
        if (is_array($cached) && ($cached['success'] ?? null) === true) {
            return $cached;
        }

        // 2) 미스 -> API 호출
        try {
            $queryString = http_build_query([
                'json'         => 1,
                'language'     => 'all',
                'num_per_page' => 0,
            ]);

            $result = $this->requestJson('GET', $this->steamBaseUrl . '/appreviews/' . $appId . '?' . $queryString);
            $reviewData = $result['query_summary'] ?? null;

            if (!is_array($reviewData)) {
                $fail = ['success' => false];
                $this->cache->setJson($cacheKey, self::TTL_NEGATIVE, $fail);
                return $fail;
            }

            $payload = ['success' => true, ...$reviewData];
            $this->cache->setJson($cacheKey, self::TTL_REVIEWS, $payload);

            return $payload;
        } catch (\Throwable $e) {
            if (is_array($cached)) return $cached;
            throw $e;
        }
    }

    /* =========================================================
     * 3) Sub details (store api/packagedetails)
     * ========================================================= */

    public function getSubData(string|int $subId, string $country = 'KR'): array
    {
        $subId = (string)$subId;
        if ($subId === '' || !preg_match('/^\d+$/', $subId)) {
            return ['success' => false];
        }

        $country = $this->normalizeCountry($country);
        $cacheKey = "steam:store:sub:v1:{$country}:{$subId}";

        $cached = $this->cache->getJson($cacheKey);
        if (is_array($cached) && ($cached['success'] ?? null) === true) {
            return $cached;
        }

        try {
            $json = $this->requestJson('GET', $this->steamBaseUrl . '/api/packagedetails', [
                'query' => [
                    'packageids' => (int)$subId,
                    'cc' => strtolower($country),
                    'l'  => 'koreana',
                ],
                'timeout' => 10,
            ]);

            if (!isset($json[$subId]) || !is_array($json[$subId])) {
                $fail = ['success' => false];
                $this->cache->setJson($cacheKey, self::TTL_NEGATIVE, $fail);
                return $fail;
            }

            $node = $json[$subId];
            if (($node['success'] ?? false) !== true || !is_array($node['data'] ?? null)) {
                $fail = ['success' => false];
                $this->cache->setJson($cacheKey, self::TTL_NEGATIVE, $fail);
                return $fail;
            }

            $data = $node['data'];

            // packagedetails price는 cents 단위
            $p = is_array($data['price'] ?? null) ? $data['price'] : null;
            $currency = $p ? (string)($p['currency'] ?? 'KRW') : 'KRW';
            $regular = ($p && isset($p['initial'])) ? ((int)$p['initial'] / 100) : null;
            $final   = ($p && isset($p['final'])) ? ((int)$p['final'] / 100) : null;
            $dp      = ($p && isset($p['discount_percent'])) ? (int)$p['discount_percent'] : 0;

            $payload = [
                'success' => true,
                'id' => (int)$subId,
                'title' => (string)($data['name'] ?? '패키지 상품'),
                'header_image' => $data['header_image'] ?? null,
                'page_image' => $data['page_image'] ?? null,
                'small_logo' => $data['small_logo'] ?? null,
                'apps' => array_values(array_map(
                    static fn(array $app) => [
                        'id' => (int)($app['id'] ?? 0),
                        'name' => (string)($app['name'] ?? ''),
                    ],
                    is_array($data['apps'] ?? null) ? $data['apps'] : []
                )),
                'price' => ($regular !== null && $final !== null) ? [
                    'currency' => $currency,
                    'regular' => $regular,
                    'final' => $final,
                    'discount_percent' => $dp,
                ] : null,
                'platforms' => is_array($data['platforms'] ?? null) ? $data['platforms'] : [],
                'release_date' => is_array($data['release_date'] ?? null) ? (string)($data['release_date']['date'] ?? '') : '',
            ];

            $this->cache->setJson($cacheKey, self::TTL_SUBDETAILS, $payload);
            return $payload;
        } catch (\Throwable $e) {
            if (is_array($cached)) return $cached;
            throw $e;
        }
    }

    /* =========================================================
     * 4) Bundle resolve (actions/ajaxresolvebundles)
     * ========================================================= */

    public function getBundleData(string|int $bundleId, string $country = 'KR'): array
    {
        $bundleId = (string)$bundleId;
        if ($bundleId === '' || !preg_match('/^\d+$/', $bundleId)) {
            return ['success' => false];
        }

        $country = $this->normalizeCountry($country);
        $cacheKey = "steam:store:bundle:v1:{$country}:{$bundleId}";

        $cached = $this->cache->getJson($cacheKey);
        if (is_array($cached) && ($cached['success'] ?? null) === true) {
            return $cached;
        }

        try {
            $json = $this->requestJson('GET', $this->steamBaseUrl . '/actions/ajaxresolvebundles', [
                'query' => [
                    'bundleids' => (int)$bundleId,
                    'cc' => strtolower($country),
                    'l'  => 'koreana',
                    'origin' => 'https://store.steampowered.com',
                ],
                'timeout' => 10,
            ]);

            if (!is_array($json) || count($json) < 1) {
                $fail = ['success' => false];
                $this->cache->setJson($cacheKey, self::TTL_NEGATIVE, $fail);
                return $fail;
            }

            $row = null;
            foreach ($json as $r) {
                if (is_array($r) && (int)($r['bundleid'] ?? 0) === (int)$bundleId) {
                    $row = $r;
                    break;
                }
            }
            if (!is_array($row)) {
                $row = is_array($json[0] ?? null) ? $json[0] : null;
            }

            if (!is_array($row)) {
                $fail = ['success' => false];
                $this->cache->setJson($cacheKey, self::TTL_NEGATIVE, $fail);
                return $fail;
            }

            $regular = $this->parseKrwFormattedToInt($row['formatted_orig_price'] ?? null);
            $final   = $this->parseKrwFormattedToInt($row['formatted_final_price'] ?? null);

            $payload = [
                'success' => true,
                'id' => (int)$bundleId,
                'title' => (string)($row['name'] ?? '번들 상품'),
                'header_image' => $row['header_image_url'] ?? null,
                'page_image' => $row['main_capsule'] ?? null,
                'small_logo' => $row['library_asset'] ?? null,

                'appids' => array_values(array_map('intval', is_array($row['appids'] ?? null) ? $row['appids'] : [])),
                'packageids' => array_values(array_map('intval', is_array($row['packageids'] ?? null) ? $row['packageids'] : [])),

                'formatted' => [
                    'regular' => $row['formatted_orig_price'] ?? null,
                    'final' => $row['formatted_final_price'] ?? null,
                ],

                'price' => ($regular !== null && $final !== null) ? [
                    'currency' => 'KRW',
                    'regular' => $regular,
                    'final' => $final,
                    'discount_percent' => isset($row['discount_percent']) ? (int)$row['discount_percent'] : null,
                ] : null,

                'platforms' => [
                    'windows' => (bool)($row['available_windows'] ?? false),
                    'mac' => (bool)($row['available_mac'] ?? false),
                    'linux' => (bool)($row['available_linux'] ?? false),
                ],

                'deck_compatibility_category' => $row['deck_compatibility_category'] ?? null,
            ];

            $this->cache->setJson($cacheKey, self::TTL_BUNDLE_RESOLVE, $payload);
            return $payload;
        } catch (\Throwable $e) {
            if (is_array($cached)) return $cached;
            throw $e;
        }
    }

    private function parseKrwFormattedToInt(mixed $v): ?int
    {
        if (!is_string($v) || $v === '') return null;
        $digits = preg_replace('/[^\d]/', '', $v);
        if (!is_string($digits) || $digits === '') return null;
        return (int)$digits;
    }

    /* =========================================================
     * 5) DLC for app (api/dlcforapp)
     * - B 방식: 프론트 비용 절감을 위해 서버에서 집계/정규화까지 완료해서 반환
     * ========================================================= */

    public function getDlcForApp(string|int $appId, string $country = 'KR'): array
    {
        $appId = (string)$appId;
        if ($appId === '' || !preg_match('/^\d+$/', $appId)) {
            return ['success' => false];
        }

        $country = $this->normalizeCountry($country);
        $cacheKey = "steam:store:dlcforapp:v2:{$country}:{$appId}";

        // 1) 캐시 히트
        $cached = $this->cache->getJson($cacheKey);
        if (is_array($cached) && ($cached['success'] ?? null) === true) {
            return $cached;
        }

        try {
            $json = $this->requestJson('GET', $this->steamBaseUrl . '/api/dlcforapp/', [
                'query' => [
                    'appid' => (int)$appId,
                    'cc' => strtolower($country),
                    'l' => 'koreana',
                ],
                'timeout' => 10,
            ]);

            // 응답 예: { status:1, appid:"960170", name:"...", dlc:[...] }
            if (!is_array($json) || (int)($json['status'] ?? 0) !== 1) {
                $fail = ['success' => false];
                $this->cache->setJson($cacheKey, self::TTL_NEGATIVE, $fail);
                return $fail;
            }

            $items = [];
            $totalRegular = 0;
            $totalFinal = 0;
            $currency = null;
            $pricedCount = 0;

            if (is_array($json['dlc'] ?? null)) {
                foreach ($json['dlc'] as $d) {
                    if (!is_array($d)) continue;

                    $po = is_array($d['price_overview'] ?? null) ? $d['price_overview'] : null;

                    // dlcforapp의 price_overview는 cents 단위
                    $itemCurrency = $po ? (string)($po['currency'] ?? '') : null;
                    $regular = $po && isset($po['initial']) ? (int)($po['initial'] / 100) : null;
                    $final   = $po && isset($po['final']) ? (int)($po['final'] / 100) : null;
                    $dp      = $po && isset($po['discount_percent']) ? (int)$po['discount_percent'] : null;

                    if ($currency === null && $itemCurrency) {
                        $currency = $itemCurrency;
                    }

                    // 집계(가격이 있는 경우만)
                    if ($final !== null || $regular !== null) {
                        $pricedCount++;
                        if ($regular !== null) $totalRegular += $regular;
                        if ($final !== null) $totalFinal += $final;
                    }

                    $items[] = [
                        'id' => (int)($d['id'] ?? 0),
                        'name' => (string)($d['name'] ?? ''),
                        'header_image' => $d['header_image'] ?? null,
                        'price' => $po ? [
                            'currency' => $itemCurrency,
                            'regular' => $regular,
                            'final' => $final,
                            'discount_percent' => $dp,
                        ] : null,
                        'platforms' => is_array($d['platforms'] ?? null) ? $d['platforms'] : null,
                        'release_date' => is_array($d['release_date'] ?? null) ? $d['release_date'] : null,
                    ];
                }
            }

            $payload = [
                'success' => true,
                'appid' => (string)($json['appid'] ?? $appId),
                'name' => (string)($json['name'] ?? ''),
                'count' => count($items),
                'priced_count' => $pricedCount,
                'currency' => $currency ?: 'KRW',
                'total_regular' => $totalRegular,
                'total_final' => $totalFinal,
                'items' => $items,
            ];

            $this->cache->setJson($cacheKey, self::TTL_DLC_FOR_APP, $payload);
            return $payload;
        } catch (\Throwable $e) {
            if (is_array($cached)) return $cached;
            throw $e;
        }
    }
}
