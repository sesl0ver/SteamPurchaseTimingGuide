<?php
declare(strict_types=1);

namespace App\Controller\Api;

use App\Service\ItadClient;
use App\Service\SteamDealHelper;
use App\Service\LookupTrendTracker;
use App\Service\Fingerprint;
use GuzzleHttp\ClientInterface;
use GuzzleHttp\Exception\GuzzleException;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

final class DealController
{
    public function __construct(
        private readonly SteamDealHelper $dealHelper,
        private readonly ItadClient $itadClient,
        private readonly ClientInterface $http,
        private readonly LookupTrendTracker $trendTracker,
    ) {}

    /**
     * ✅ /api/deal/{steam_appid}
     * (기존 유지) AppID 기준
     *
     * ✅ 변경점(간접):
     * - SteamDealHelper::build()가 steam.app.dlc(count/total/items) 형태를 포함하도록 업데이트됨
     * - 컨트롤러는 그대로 "build 결과를 그대로 반환" (API 형태 일관성 유지)
     */
    public function fetchApp(
        ServerRequestInterface $request,
        ResponseInterface $response,
        array $args
    ): ResponseInterface {
        $steamAppId = (string)($args['steam_appid'] ?? $args['appId'] ?? $args['id'] ?? '');
        if ($steamAppId === '' || !preg_match('/^\d+$/', $steamAppId)) {
            return $this->json($response, [
                'success' => false,
                'message' => '유효하지 않은 Steam App ID입니다.',
            ], 400);
        }

        // ✅ SteamDealHelper에서 앱 + 리뷰 + ITAD + (B 방식 DLC)까지 묶어 내려줍니다.
        $result = $this->dealHelper->build($steamAppId, 'KR');
        if ($result === null) {
            return $this->json($response, [
                'success' => false,
                'message' => '게임 정보를 불러올 수 없습니다.',
            ], 404);
        }

        // ✅ 조회 성공 시점에서만 Redis 기록 (요구사항 그대로)
        $kind = (string)($result['meta']['kind'] ?? '');
        $id = (string)($result['meta']['id'] ?? '');
        $steamUrl = (string)($result['meta']['steam_url'] ?? '');
        $title = (string)($result['steam']['app']['title'] ?? '');
        $headerImage = (string)($result['steam']['app']['header_image'] ?? '');

        // Log
        $fp = Fingerprint::fromRequest($request);

        $this->trendTracker->record(
            $fp,
            $kind,
            (string)$id,
            $title,
            $headerImage,
            $steamUrl
        );


        return $this->json($response, [
            'success' => true,
            'data' => $result,
        ]);
    }

    /**
     * ✅ /api/deal/sub/{sub_id}
     * - Steam packagedetails + ITAD(overview에서 current/lowest)
     */
    public function fetchSub(
        ServerRequestInterface $request,
        ResponseInterface $response,
        array $args
    ): ResponseInterface {
        $subId = (string)($args['sub_id'] ?? '');
        if ($subId === '' || !preg_match('/^\d+$/', $subId)) {
            return $this->json($response, [
                'success' => false,
                'message' => '유효하지 않은 Steam 패키지(Sub) ID입니다.',
            ], 400);
        }

        $country = 'KR';

        // 1) Steam packagedetails
        $steamPack = $this->fetchSteamPackageDetails((int)$subId, $country);
        if ($steamPack === null) {
            return $this->json($response, [
                'success' => false,
                'message' => 'Steam 패키지 정보를 불러올 수 없습니다.',
            ], 404);
        }

        // 2) normalize
        $steamSub = $this->normalizeSteamSubPayload($subId, $steamPack);

        // 3) ITAD (sub) : (⚠️ ItadClient 3번에서 getDealBySteamSubId가 overview를 포함하도록 맞출 예정)
        $itad = $this->itadClient->getDealBySteamSubId($subId, $country);
        $overview = is_array($itad['overview'] ?? null) ? $itad['overview'] : null;
        $historyLow = is_array($itad['history_low'] ?? null) ? $itad['history_low'] : null;

        // 4) build deal
        $deal = $this->buildSubDealPayload($steamSub, $overview, $historyLow);

        // ✅ 응답 축소: deal 계산에만 사용한 내부 필드는 제거
        // NOTE: steam.sub.price는 클라이언트 fallback(ITAD current 없음) 및 디버그를 위해 유지합니다.

        $result = [
            'steam' => [
                'sub' => $steamSub,
            ],
            'deal' => $deal,
            'meta' => [
                'kind' => 'sub',
                'id' => (string)$subId,
                'steam_url' => "https://store.steampowered.com/sub/{$subId}/",
                'generated_at' => gmdate('c'),
            ],
        ];

        $kind = (string)($result['meta']['kind'] ?? 'sub');
        $id = (string)($result['meta']['id'] ?? $subId);
        $steamUrl = (string)($result['meta']['steam_url'] ?? "https://store.steampowered.com/sub/{$subId}/");
        $title = (string)($steamSub['title'] ?? '');
        $headerImage = (string)($steamSub['header_image'] ?? '');

        // Log
        $fp = Fingerprint::fromRequest($request);

        $this->trendTracker->record(
            $fp,
            $kind,
            (string)$id,
            $title,
            $headerImage,
            $steamUrl
        );

        return $this->json($response, [
            'success' => true,
            'data' => $result,
        ]);
    }

    /**
     * ✅ /api/deal/bundle/{bundle_id}
     * - Steam ajaxresolvebundles + ITAD(overview에서 current/lowest)
     *
     * ⚠️ 포인트
     * - Steam 쪽 bundle 가격은 포맷/단위가 케이스가 많아서: ITAD current/lowest가 있으면 그걸 "진짜 가격"으로 사용
     * - ITAD가 없을 때만 Steam formatted 가격(₩ …)을 KRW 정수로 파싱해 fallback
     */
    public function fetchBundle(
        ServerRequestInterface $request,
        ResponseInterface $response,
        array $args
    ): ResponseInterface {
        $bundleId = (string)($args['bundle_id'] ?? '');
        if ($bundleId === '' || !preg_match('/^\d+$/', $bundleId)) {
            return $this->json($response, [
                'success' => false,
                'message' => '유효하지 않은 Steam 번들(Bundle) ID입니다.',
            ], 400);
        }

        $country = 'KR';

        // 1) Steam bundle info
        $bundle = $this->fetchSteamBundleDetails((int)$bundleId, $country);
        if ($bundle === null) {
            return $this->json($response, [
                'success' => false,
                'message' => 'Steam 번들 정보를 불러올 수 없습니다.',
            ], 404);
        }

        // 2) normalize
        $steamBundle = $this->normalizeSteamBundlePayload($bundleId, $bundle);

        // 3) ITAD bundle deal (⚠️ ItadClient 3번에서 getDealBySteamBundleId 추가 예정)
        $itad = $this->itadClient->getDealBySteamBundleId($bundleId, $country);
        $overview = is_array($itad['overview'] ?? null) ? $itad['overview'] : null;
        $historyLow = is_array($itad['history_low'] ?? null) ? $itad['history_low'] : null;

        // 4) build deal
        $deal = $this->buildBundleDealPayload($steamBundle, $overview, $historyLow);

        // ✅ 응답 축소: deal 계산에만 사용한 내부 필드는 제거
        // NOTE: steam.bundle.price는 클라이언트 fallback(ITAD current 없음) 및 디버그를 위해 유지합니다.

        $result = [
            'steam' => [
                'bundle' => $steamBundle,
            ],
            'deal' => $deal,
            'meta' => [
                'kind' => 'bundle',
                'id' => (string)$bundleId,
                'steam_url' => "https://store.steampowered.com/bundle/{$bundleId}/",
                'generated_at' => gmdate('c'),
            ],
        ];

        $kind = (string)($result['meta']['kind'] ?? 'bundle');
        $id = (string)($result['meta']['id'] ?? $bundleId);
        $steamUrl = (string)($result['meta']['steam_url'] ?? "https://store.steampowered.com/bundle/{$bundleId}/");
        $title = (string)($steamBundle['title'] ?? '');
        $headerImage = (string)($steamBundle['header_image'] ?? '');

        // Log
        $fp = Fingerprint::fromRequest($request);

        $this->trendTracker->record(
            $fp,
            $kind,
            (string)$id,
            $title,
            $headerImage,
            $steamUrl
        );

        return $this->json($response, [
            'success' => true,
            'data' => $result,
        ]);
    }

    /* =========================================================
     * Steam packagedetails
     * ========================================================= */

    private function fetchSteamPackageDetails(int $subId, string $country = 'KR'): ?array
    {
        try {
            $res = $this->http->request(
                'GET',
                'https://store.steampowered.com/api/packagedetails',
                [
                    'query' => [
                        'packageids' => $subId,
                        'cc' => strtolower($country),
                        'l' => 'koreana',
                    ],
                    'timeout' => 10,
                ]
            );

            $json = json_decode((string)$res->getBody(), true);
            if (!is_array($json) || !isset($json[(string)$subId])) {
                return null;
            }

            $node = $json[(string)$subId];
            if (!is_array($node) || ($node['success'] ?? false) !== true) {
                return null;
            }

            $data = $node['data'] ?? null;
            return is_array($data) ? $data : null;
        } catch (GuzzleException) {
            return null;
        }
    }

    private function normalizeSteamSubPayload(string $subId, array $steamPack): array
    {
        $p = $steamPack['price'] ?? null;

        // packagedetails price는 cents
        $currency = is_array($p) ? (string)($p['currency'] ?? 'KRW') : 'KRW';
        $regular = (is_array($p) && isset($p['initial'])) ? ((int)$p['initial'] / 100) : null;
        $final   = (is_array($p) && isset($p['final'])) ? ((int)$p['final'] / 100) : null;
        $dp      = (is_array($p) && isset($p['discount_percent'])) ? (int)$p['discount_percent'] : 0;

        return [
            'id' => (int)$subId,
            'title' => (string)($steamPack['name'] ?? '패키지 상품'),
            'header_image' => $steamPack['header_image'] ?? null,
            'page_image' => $steamPack['page_image'] ?? null,
            // 앱(app) 대비 호환성을 위해 남겨두되, sub는 기본 0(미지원)으로 취급
            'supported_languages' => 0,
            'price' => ($regular !== null && $final !== null) ? [
                'currency' => $currency,
                'regular' => $regular,
                'final' => $final,
                'discount_percent' => $dp,
            ] : null,
            'release_date' => is_array($steamPack['release_date'] ?? null) ? (string)($steamPack['release_date']['date'] ?? '') : '',
        ];
    }

    /* =========================================================
     * Steam bundle: ajaxresolvebundles
     * ========================================================= */

    private function fetchSteamBundleDetails(int $bundleId, string $country = 'KR'): ?array
    {
        try {
            $res = $this->http->request(
                'GET',
                'https://store.steampowered.com/actions/ajaxresolvebundles',
                [
                    'query' => [
                        'bundleids' => $bundleId,
                        'cc' => strtolower($country),
                        'l' => 'koreana',
                        'origin' => 'https://store.steampowered.com',
                    ],
                    'timeout' => 10,
                    'headers' => [
                        'Accept' => 'application/json',
                    ],
                ]
            );

            $json = json_decode((string)$res->getBody(), true);
            if (!is_array($json) || count($json) < 1) {
                return null;
            }

            // 응답은 배열
            foreach ($json as $row) {
                if (is_array($row) && (int)($row['bundleid'] ?? 0) === $bundleId) {
                    return $row;
                }
            }

            // 단일일 때도 보정
            return is_array($json[0] ?? null) ? $json[0] : null;
        } catch (GuzzleException) {
            return null;
        }
    }

    private function normalizeSteamBundlePayload(string $bundleId, array $bundle): array
    {
        // bundle의 formatted 가격(₩ 744,160)에서 숫자만 뽑아 KRW 정수로 파싱
        $regular = $this->parseKrwFormattedToInt($bundle['formatted_orig_price'] ?? null);
        $final   = $this->parseKrwFormattedToInt($bundle['formatted_final_price'] ?? null);
        $dp      = isset($bundle['discount_percent']) ? (int)$bundle['discount_percent'] : null;

        return [
            'id' => (int)$bundleId,
            'title' => (string)($bundle['name'] ?? '번들 상품'),
            'header_image' => $bundle['header_image_url'] ?? null,
            'page_image' => $bundle['main_capsule'] ?? null,
            // 앱(app) 대비 호환성을 위해 남겨두되, bundle은 기본 0(미지원)으로 취급
            'supported_languages' => 0,

            // deal fallback 계산용으로만 사용 (응답 직전에 제거)
            'price' => ($regular !== null && $final !== null) ? [
                'currency' => 'KRW',
                'regular' => $regular,
                'final' => $final,
                'discount_percent' => $dp,
            ] : null,

            // bundle은 날짜가 애매해서 비움
            'release_date' => '',

        ];
    }

    private function parseKrwFormattedToInt(mixed $v): ?int
    {
        if (!is_string($v) || $v === '') return null;
        $digits = preg_replace('/[^\d]/', '', $v);
        if (!is_string($digits) || $digits === '') return null;
        return (int)$digits;
    }

    /* =========================================================
     * Deal merge: sub
     * ========================================================= */

    private function buildSubDealPayload(array $steamSub, ?array $overview, ?array $historyLow): array
    {
        $steamPrice = $steamSub['price'] ?? null;
        $fallbackCurrency = is_array($steamPrice) ? ($steamPrice['currency'] ?? 'KRW') : 'KRW';

        $deal = [
            'source' => 'isthereanydeal',
            'status' => 'unavailable',
            'message' => '가격 정보를 확인할 수 없습니다.',
        ];

        // 1) ITAD overview에서 current
        $current = $this->extractCurrentFromOverview($overview);
        if (is_array($current) && $current['amount'] !== null) {
            $deal['status'] = 'available';
            $deal['current'] = [
                'amount' => $current['amount'],
                'currency' => $current['currency'] ?? $fallbackCurrency,
                'discount_percent' => $current['discount_percent'] ?? 0,
                'regular_price' => $current['regular_price'] ?? null,
                'expiry_at' => $current['expiry_at'] ?? null,
                'shop' => $current['shop'] ?? 'Steam',
            ];
            unset($deal['message']);
        } else {
            // 2) fallback: Steam packagedetails price
            if (is_array($steamPrice) && isset($steamPrice['final'], $steamPrice['regular'])) {
                $deal['status'] = 'available';
                $deal['current'] = [
                    'amount' => $steamPrice['final'],
                    'currency' => $steamPrice['currency'] ?? $fallbackCurrency,
                    'discount_percent' => $steamPrice['discount_percent'] ?? 0,
                    'regular_price' => $steamPrice['regular'],
                    'expiry_at' => null,
                    'shop' => 'Steam',
                ];
                $deal['message'] = '패키지 상품은 가격 이력 정보를 제공하지 않을 수 있습니다.';
            }
        }

        // 3) historical low: historylow/v1이 있으면 우선, 없으면 overview['lowest'] 사용
        $low = $this->extractHistoryLowNormalized($historyLow);
        if (!is_array($low)) {
            $low = $this->extractLowestFromOverview($overview);
        }

        if (is_array($low) && $low['amount'] !== null) {
            $curAmount = $deal['current']['amount'] ?? null;
            $isLowestNow = ($curAmount !== null && (int)$curAmount === (int)$low['amount']);

            $deal['historical_low'] = [
                'amount' => $low['amount'],
                'currency' => $low['currency'] ?? $fallbackCurrency,
                'discount_percent' => $low['discount_percent'],
                'last_seen_at' => $low['last_seen_at'],
                'is_lowest_now' => $low['is_lowest_now'] ?? $isLowestNow,
            ];
        }

        return $deal;
    }

    /* =========================================================
     * Deal merge: bundle
     * ========================================================= */

    private function buildBundleDealPayload(array $steamBundle, ?array $overview, ?array $historyLow): array
    {
        $steamPrice = $steamBundle['price'] ?? null;
        $fallbackCurrency = is_array($steamPrice) ? ($steamPrice['currency'] ?? 'KRW') : 'KRW';

        $deal = [
            'source' => 'isthereanydeal',
            'status' => 'unavailable',
            'message' => '가격 정보를 확인할 수 없습니다.',
        ];

        // 1) ITAD overview current 우선
        $current = $this->extractCurrentFromOverview($overview);
        if (is_array($current) && $current['amount'] !== null) {
            $deal['status'] = 'available';
            $deal['current'] = [
                'amount' => $current['amount'],
                'currency' => $current['currency'] ?? $fallbackCurrency,
                'discount_percent' => $current['discount_percent'] ?? 0,
                'regular_price' => $current['regular_price'] ?? null,
                'expiry_at' => $current['expiry_at'] ?? null,
                'shop' => $current['shop'] ?? 'Steam',
            ];
            unset($deal['message']);
        } else {
            // 2) fallback: Steam bundle formatted 가격 파싱 결과
            if (is_array($steamPrice) && isset($steamPrice['final'], $steamPrice['regular'])) {
                $deal['status'] = 'available';
                $deal['current'] = [
                    'amount' => $steamPrice['final'],
                    'currency' => $steamPrice['currency'] ?? $fallbackCurrency,
                    'discount_percent' => $steamPrice['discount_percent'] ?? 0,
                    'regular_price' => $steamPrice['regular'],
                    'expiry_at' => null,
                    'shop' => 'Steam',
                ];
                // 번들은 스토어 계산 로직이 복잡할 수 있어서 안내 문구
                $deal['message'] = '번들 가격은 구매 구성에 따라 달라질 수 있습니다. Steam에서 최종 금액을 꼭 확인해 주세요.';
            }
        }

        // 3) historical low
        $low = $this->extractHistoryLowNormalized($historyLow);
        if (!is_array($low)) {
            $low = $this->extractLowestFromOverview($overview);
        }

        if (is_array($low) && $low['amount'] !== null) {
            $curAmount = $deal['current']['amount'] ?? null;
            $isLowestNow = ($curAmount !== null && (int)$curAmount === (int)$low['amount']);

            $deal['historical_low'] = [
                'amount' => $low['amount'],
                'currency' => $low['currency'] ?? $fallbackCurrency,
                'discount_percent' => $low['discount_percent'],
                'last_seen_at' => $low['last_seen_at'],
                'is_lowest_now' => $low['is_lowest_now'] ?? $isLowestNow,
            ];
        }

        return $deal;
    }

    /* =========================================================
     * ITAD overview extractors (current/lowest)
     * ========================================================= */

    private function extractCurrentFromOverview(?array $overview): ?array
    {
        if (!is_array($overview)) return null;

        // overview['current'] 형태
        if (isset($overview['current']) && is_array($overview['current'])) {
            $c = $overview['current'];
            return [
                'amount' => $this->toIntOrNull($c['price']['amountInt'] ?? $c['price']['amount'] ?? null),
                'currency' => $c['price']['currency'] ?? null,
                'discount_percent' => $this->toIntOrNull($c['cut'] ?? null) ?? 0,
                'regular_price' => $this->toIntOrNull($c['regular']['amountInt'] ?? $c['regular']['amount'] ?? null),
                'expiry_at' => $c['expiry'] ?? null,
                'shop' => $c['shop']['name'] ?? null,
            ];
        }

        // (혹시 다른 형태로 올 때 대비)
        if (isset($overview['price']) && is_array($overview['price'])) {
            $p = $overview['price'];
            return [
                'amount' => $this->toIntOrNull($p['amount'] ?? $p['final'] ?? null),
                'currency' => $p['currency'] ?? null,
                'discount_percent' => $this->toIntOrNull($p['discountPercent'] ?? $p['discount_percent'] ?? null) ?? 0,
                'regular_price' => $this->toIntOrNull($p['regular'] ?? $p['regular_price'] ?? $p['initial'] ?? null),
                'expiry_at' => $p['expiry'] ?? $p['expiry_at'] ?? null,
                'shop' => $p['shop']['name'] ?? ($p['shopName'] ?? null),
            ];
        }

        return null;
    }

    private function extractLowestFromOverview(?array $overview): ?array
    {
        if (!is_array($overview)) return null;

        if (isset($overview['lowest']) && is_array($overview['lowest'])) {
            $l = $overview['lowest'];
            return [
                'amount' => $this->toIntOrNull($l['price']['amountInt'] ?? $l['price']['amount'] ?? null),
                'currency' => $l['price']['currency'] ?? null,
                'discount_percent' => $this->toIntOrNull($l['cut'] ?? null),
                'last_seen_at' => $l['timestamp'] ?? null,
                'is_lowest_now' => null,
            ];
        }

        return null;
    }

    /**
     * historylow/v1 포맷/커스텀 포맷 모두 지원
     */
    private function extractHistoryLowNormalized(?array $historyLow): ?array
    {
        if (!is_array($historyLow)) return null;

        // Case A) historylow/v1 리스트: [ { id, low: { ... } } ]
        if (isset($historyLow[0]['low']) && is_array($historyLow[0]['low'])) {
            $low = $historyLow[0]['low'];

            $amount = $this->toIntOrNull($low['price']['amountInt'] ?? $low['price']['amount'] ?? null);
            if ($amount === null) return null;

            return [
                'amount' => $amount,
                'currency' => $low['price']['currency'] ?? null,
                'discount_percent' => $this->toIntOrNull($low['cut'] ?? null),
                'last_seen_at' => $low['timestamp'] ?? null,
                'is_lowest_now' => null,
            ];
        }

        // Case B) 이미 정규화된 형태
        $amount = $this->toIntOrNull($historyLow['amount'] ?? $historyLow['price'] ?? null);
        if ($amount === null) return null;

        return [
            'amount' => $amount,
            'currency' => $historyLow['currency'] ?? null,
            'discount_percent' => $this->toIntOrNull($historyLow['discountPercent'] ?? $historyLow['discount_percent'] ?? null),
            'last_seen_at' => $historyLow['lastSeen'] ?? $historyLow['last_seen_at'] ?? $historyLow['lastSeenAt'] ?? null,
            'is_lowest_now' => (bool)($historyLow['isLowest'] ?? $historyLow['is_lowest_now'] ?? false),
        ];
    }

    private function toIntOrNull(mixed $v): ?int
    {
        if ($v === null) return null;
        if (is_int($v)) return $v;
        if (is_float($v)) return (int)$v;
        if (is_string($v) && $v !== '' && is_numeric($v)) return (int)$v;
        return null;
    }

    /* =========================================================
     * JSON helper
     * ========================================================= */

    private function json(
        ResponseInterface $response,
        array $payload,
        int $status = 200
    ): ResponseInterface {
        $response->getBody()->write(
            json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
        );

        return $response
            ->withHeader('Content-Type', 'application/json')
            ->withStatus($status);
    }
}
