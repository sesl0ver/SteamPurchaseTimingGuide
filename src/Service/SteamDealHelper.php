<?php
declare(strict_types=1);

namespace App\Service;

use App\Repository\CommunityKoreanPatchRepository;

final class SteamDealHelper
{
    // 일부 게임ID가 아닌 다르ID에 가격정보가 붙어있는 경우를 위한 우회 경로
    private const ITAD_PRICE_TARGET_OVERRIDES = [
        3101040 => ['type' => 'sub', 'id' => 1101478], // Magical Girl Witch Trials (魔法少女ノ魔女裁判)
    ];

    public function __construct(
        private readonly SteamClient $steamClient,
        private readonly ItadClient  $itadClient,
        private readonly CommunityKoreanPatchRepository $communityPatchRepo,
        private readonly CommunityKoreanPatchParser $communityPatchParser,
    ) {}

    /**
     * Steam AppID 기준 딜 정보 묶음 생성 (기존 유지)
     * ✅ B 방식: DLC는 서버에서 집계/정규화된 형태로 포함(프론트 비용 절감)
     * ✅ 추가: community_korean_patch(DB)에서 커뮤니티 한글패치 근거 병합
     */
    public function build(string|int $steamAppId, string $country = 'KR'): ?array
    {
        $steamAppId = (string)$steamAppId;

        $appData = $this->steamClient->getAppData($steamAppId, $country);
        if (!($appData['success'] ?? false)) {
            return null;
        }

        // ✅ DLC 집계/정규화(v2)
        $dlc = $this->steamClient->getDlcForApp($steamAppId, $country);
        if (!is_array($dlc) || !($dlc['success'] ?? false)) {
            $dlc = [
                'success' => false,
                'appid' => $steamAppId,
                'name' => (string)($appData['name'] ?? ''),
                'count' => 0,
                'priced_count' => 0,
                'currency' => 'KRW',
                'total_regular' => 0,
                'total_final' => 0,
                'items' => [],
            ];
        }

        $reviews = $this->steamClient->getReviews($steamAppId);
        if (!($reviews['success'] ?? false)) {
            $reviews = null;
        }

        // 특정 ID는 다른 ID에 가격 정보가 연결되어있어 우회시도
        if (array_key_exists($steamAppId, self::ITAD_PRICE_TARGET_OVERRIDES)) {
            $overrideSubId = self::ITAD_PRICE_TARGET_OVERRIDES[$steamAppId]['id'];
            // $overrideType = self::ITAD_PRICE_TARGET_OVERRIDES[$steamAppId]['type']; TODO 차후 다른 타입이랑 연결된 경우가 있을 수 있으므로 살려둠.
            $itad = $this->itadClient->getDealBySteamSubId((string)$overrideSubId, $country);
            $deal = $this->buildDealDataFromOverview($itad);
        } else {
            $itad = $this->itadClient->getOverviewBySteamAppId($steamAppId, $country);
            $deal = $this->buildDealDataFromOverview($itad);
        }

        // ✅ 커뮤니티 한글패치(DB) 조회 + 파싱
        $patchRow = $this->communityPatchRepo->findByAppId((int)$steamAppId);
        $communityPatch = $this->communityPatchParser->fromRow($patchRow);

        return [
            'steam' => [
                'app'     => $this->buildSteamAppData($appData, $dlc),
                'reviews' => $this->buildSteamReviewData($reviews),

                // ✅ 추가됨: 커뮤니티 한글패치 근거
                'korean' => [
                    'community_patch' => $communityPatch,
                ],
            ],
            'deal' => $deal,
            'meta' => [
                'kind'        => 'app',
                'id'          => $steamAppId,
                'steam_url'   => "https://store.steampowered.com/app/{$steamAppId}/",
                'country'     => $country,
                'generated_at'=> date(DATE_ATOM),
            ],
        ];
    }

    /* =========================
     * Steam data builders
     * ========================= */

    private function buildSteamAppData(array $appData, array $dlcSummary): array
    {
        // =========================================================
        // ✅ 반환값 정리 기준 반영
        // - 현재 클라이언트에서 실제로 쓰는 값만 유지
        // - 서버에서 가공 가능한 값은 서버에서 먼저 가공해 추가
        // - 문구/표현은 클라이언트에서(서버는 데이터만)
        // - 현재 출력물(렌더링 결과)은 그대로 유지
        // =========================================================

        $packages = is_array($appData['packages'] ?? null) ? $appData['packages'] : [];
        $packageGroups = is_array($appData['package_groups'] ?? null) ? $appData['package_groups'] : [];

        $packagesCount = count($packages);
        $packageGroupsCount = count($packageGroups);

        // Steam price 존재 여부(구매 가능 판정 신호)
        $hasSteamPrice = (
            isset($appData['price']) &&
            (
                is_numeric($appData['price']['discount_price'] ?? null) ||
                is_numeric($appData['price']['regular_price'] ?? null)
            )
        );

        // ✅ 구매 옵션: package_groups 파싱을 서버로 이동
        $currency = (string)($dlcSummary['currency'] ?? 'KRW');
        $purchaseOptions = $this->buildPurchaseOptionsFromPackageGroups($packageGroups, $currency);

        return [
            'title' => $appData['name'] ?? null,
            'header_image' => $appData['header_image'] ?? null,
            'supported_languages' => $appData['supported_languages'] ?? 0,
            'genres' => $appData['genres'] ? array_column($appData['genres'], 'description') : [],

            // 가격(데이터만)
            'price' => [
                'regular'  => $appData['price']['regular_price'] ?? null,
                'final'    => $appData['price']['discount_price'] ?? null,
                'discount_percent' => $appData['price']['discount_percent'] ?? null,
            ],

            // 도전과제
            'achievement_count' => $appData['achievements']['total'] ?? 0,

            // ✅ 기존 렌더링 유지용: 구매 가능 판정 신호/디버그
            // (클라이언트가 packages / package_groups 원본을 받지 않아도 동일 로직으로 판정 가능)
            'purchasable_signals' => [
                'packages_count' => $packagesCount,
                'package_groups_count' => $packageGroupsCount,
                'has_steam_price' => $hasSteamPrice,
            ],

            // ✅ 구매 옵션(서버 정제 결과)
            // - 클라이언트는 이 데이터를 그대로 이용해 UI 텍스트를 구성
            'purchase_options' => $purchaseOptions,

            // DLC(기존 유지: 이미 서버에서 정규화/집계)
            'dlc' => [
                'count' => (int)($dlcSummary['count'] ?? 0),
                'priced_count' => (int)($dlcSummary['priced_count'] ?? 0),
                'currency' => (string)($dlcSummary['currency'] ?? 'KRW'),
                'total_regular' => (int)($dlcSummary['total_regular'] ?? 0),
                'total_final' => (int)($dlcSummary['total_final'] ?? 0),
                'items' => is_array($dlcSummary['items'] ?? null) ? $dlcSummary['items'] : [],
            ],

            'release_date' => $appData['release_date']['date'] ?? null,
            'is_coming_soon'=> $appData['release_date']['coming_soon'] ?? null,

            // 디버깅/확인용(필요 최소)
            'debug' => [
                'steam' => [
                    'packages_count' => $packagesCount,
                    'package_groups_count' => $packageGroupsCount,
                ],
            ],
        ];
    }

    /**
     * Steam package_groups에서 구매 옵션을 정규화
     * - 클라이언트(CardsRenderer)에서 하던 option_text/percent 파싱을 서버로 이동
     * - 문구는 클라이언트가 구성하므로, 여기서는 데이터만 반환
     *
     * @return array{title: string, items: array<int, array{packageid:int|string|null,name:string,discount_percent:int,original_price:int|null,final_price:int|null,currency:string}>}
     */
    private function buildPurchaseOptionsFromPackageGroups(array $packageGroups, string $currency = 'KRW'): array
    {
        $groups = $packageGroups;
        $default = null;
        foreach ($groups as $g) {
            $name = strtolower((string)($g['name'] ?? ''));
            if ($name === 'default') {
                $default = $g;
                break;
            }
        }
        $g = $default ?? ($groups[0] ?? null);

        $title = (string)($g['title'] ?? '구매 옵션');
        $subs = is_array($g['subs'] ?? null) ? $g['subs'] : [];

        $items = [];
        foreach ($subs as $s) {
            $packageId = $s['packageid'] ?? null;
            if ($packageId === null) continue;

            // percent_savings_text: "-50%" 같은 문자열
            $percentText = (string)($s['percent_savings_text'] ?? '');
            $dp = (int)preg_replace('/[^0-9]/', '', $percentText);
            if ($dp < 0) $dp = 0;
            if ($dp > 95) $dp = 95;

            // option_text: HTML/엔티티 포함 → 텍스트만
            $raw = html_entity_decode((string)($s['option_text'] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8');
            $plain = trim(preg_replace('/\s+/', ' ', strip_tags($raw)));

            // 이름: "₩" 이전 문자열을 우선 사용
            $name = $plain;
            $idx = mb_strpos($plain, '₩');
            if ($idx !== false && $idx > 0) {
                $name = trim(mb_substr($plain, 0, $idx));
            }
            $name = preg_replace('/\s*-\s*$/u', '', (string)$name);
            $name = trim((string)$name);
            if ($name === '') {
                $name = '구매 옵션';
            }

            // final_price: price_in_cents_with_discount가 있으면 우선(센트 → 원)
            $final = null;
            if (isset($s['price_in_cents_with_discount']) && is_numeric($s['price_in_cents_with_discount'])) {
                $cents = (float)$s['price_in_cents_with_discount'];
                $final = (int)round($cents / 100.0);
            }

            // option_text에서 "₩ 12,345" 패턴을 추출해 original/final 추정
            $original = null;
            if (preg_match_all('/₩\s*[0-9,]+/u', $plain, $m)) {
                $nums = [];
                foreach (($m[0] ?? []) as $txt) {
                    $n = (int)str_replace(',', '', preg_replace('/[^0-9,]/', '', (string)$txt));
                    if ($n > 0) $nums[] = $n;
                }
                if (count($nums) >= 2) {
                    $max = max($nums);
                    $min = min($nums);
                    $original = $max;
                    if ($final === null) $final = $min;
                } elseif (count($nums) === 1) {
                    if ($final === null) $final = $nums[0];
                }
            }

            $items[] = [
                'packageid' => $packageId,
                'name' => (string)$name,
                'discount_percent' => $dp,
                'original_price' => $original,
                'final_price' => $final,
                'currency' => $currency,
            ];
        }

        return [
            'title' => $title,
            'items' => $items,
        ];
    }

    private function buildSteamReviewData(?array $reviews): ?array
    {
        if ($reviews === null) {
            return null;
        }

        return [
            'summary' => $reviews['review_score_desc'] ?? null,
            'total'   => $reviews['total_reviews'] ?? null,
            'positive'=> $reviews['total_positive'] ?? null,
            'negative'=> $reviews['total_negative'] ?? null,
        ];
    }

    /* =========================
     * Deal data builders
     * ========================= */

    private function buildDealDataFromOverview(?array $itad): array
    {
        if (
            !$itad ||
            !($itad['itadId'] ?? null) ||
            !($itad['overview'] ?? null)
        ) {
            return [
                'source'  => 'isthereanydeal',
                'status'  => 'unavailable',
                'message' => '가격 히스토리 정보를 확인할 수 없습니다.',
            ];
        }

        $o = $itad['overview'];

        $currentPrice = $o['current']['price']['amount'] ?? null;
        $lowestPrice  = $o['lowest']['price']['amount'] ?? null;

        return [
            'source' => 'isthereanydeal',
            'status' => 'available',

            'current' => [
                'amount' => $currentPrice,
                'currency' => $o['current']['price']['currency'] ?? null,
                'discount_percent' => $o['current']['cut'] ?? null,
                'regular_price' => $o['current']['regular']['amount'] ?? null,
                'expiry_at' => $o['current']['expiry'] ?? null,
                'shop' => $o['current']['shop']['name'] ?? null,
            ],

            'historical_low' => [
                'amount' => $lowestPrice,
                'currency' => $o['lowest']['price']['currency'] ?? null,
                'discount_percent' => $o['lowest']['cut'] ?? null,
                'last_seen_at' => $o['lowest']['timestamp'] ?? null,
                'is_lowest_now' => (
                    $currentPrice !== null &&
                    $lowestPrice !== null &&
                    $currentPrice === $lowestPrice
                ),
            ],

            'links' => [
                'deal' => $o['current']['url'] ?? null,
                'game' => $o['urls']['game'] ?? null,
            ],
        ];
    }
}
