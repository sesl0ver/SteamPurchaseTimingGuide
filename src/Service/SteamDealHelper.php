<?php
declare(strict_types=1);

namespace App\Service;

use App\Repository\CommunityKoreanPatchRepository;

final class SteamDealHelper
{
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
                'appid' => (string)$steamAppId,
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

        // 기존: overview 기반
        $itad = $this->itadClient->getOverviewBySteamAppId($steamAppId, $country);

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
            'deal' => $this->buildDealDataFromOverview($itad),
            'meta' => [
                'kind'        => 'app',
                'id'          => $steamAppId,
                'steam_url'   => "https://store.steampowered.com/app/{$steamAppId}/",
                'country'     => $country,
                'generated_at'=> date(DATE_ATOM),
            ],
        ];
    }

    /**
     * ✅ Steam SubID(패키지) 기준 딜 정보 묶음 생성
     * - Steam sub + ITAD prices/v3 + historylow/v1(가능하면) 로 current/최저가 구성
     *
     * (참고) sub/bundle까지 커뮤니티 패치를 포함하려면
     * - 구성 appids를 뽑아서 IN 조회로 확장하는 것을 권장합니다.
     */
    public function buildSub(string|int $steamSubId, string $country = 'KR'): ?array
    {
        $steamSubId = (string)$steamSubId;

        $subData = $this->steamClient->getSubData($steamSubId, $country);
        if (!($subData['success'] ?? false)) {
            return null;
        }

        $itad = $this->itadClient->getDealBySteamSubId($steamSubId, $country);

        return [
            'steam' => [
                'sub' => $this->buildSteamSubData($subData),
            ],
            'deal' => $this->buildDealDataFromPricesV3($itad, 'sub'),
            'meta' => [
                'kind'        => 'sub',
                'id'          => $steamSubId,
                'steam_url'   => "https://store.steampowered.com/sub/{$steamSubId}/",
                'title'       => $subData['title'] ?? ($subData['name'] ?? null),
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
        return [
            'title' => $appData['name'] ?? null,
            'header_image' => $appData['header_image'] ?? null,

            'supported_languages' => $appData['supported_languages'],

            'price' => [
                'regular'  => $appData['price']['regular_price'] ?? null,
                'final'    => $appData['price']['discount_price'] ?? null,
                'discount_percent' => $appData['price']['discount_percent'] ?? null,
            ],

            'packages' => $appData['packages'] ?? null,
            'package_groups' => $appData['package_groups'] ?? null,

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
        ];
    }

    private function buildSteamSubData(array $subData): array
    {
        return [
            'id' => $subData['id'] ?? null,
            'title' => $subData['title'] ?? ($subData['name'] ?? null),

            'header_image' => $subData['header_image'] ?? null,
            'page_image'   => $subData['page_image'] ?? null,
            'small_logo'   => $subData['small_logo'] ?? null,

            'apps' => $subData['apps'] ?? [],

            'price' => [
                'currency' => $subData['price']['currency'] ?? null,
                'regular'  => $subData['price']['regular'] ?? null,
                'final'    => $subData['price']['final'] ?? null,
                'discount_percent' => $subData['price']['discount_percent'] ?? null,
            ],

            'platforms' => $subData['platforms'] ?? null,
            'release_date' => $subData['release_date'] ?? null,
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

    private function buildDealDataFromPricesV3(mixed $itad, string $kind = 'sub'): array
    {
        $pricesRow = null;
        $historyLowRow = null;

        if (is_array($itad) && array_key_exists('prices', $itad)) {
            $pricesRow = $itad['prices'];
            $historyLowRow = $itad['history_low'] ?? null;
        } else {
            $pricesRow = $itad;
        }

        if (is_array($pricesRow) && isset($pricesRow[0]) && is_array($pricesRow[0]) && isset($pricesRow[0]['id'])) {
            $row = $pricesRow[0];
        } else {
            $row = is_array($pricesRow) ? $pricesRow : null;
        }

        if (!$row || !is_array($row)) {
            return [
                'source'  => 'isthereanydeal',
                'status'  => 'unavailable',
                'message' => ($kind === 'sub')
                    ? '패키지 상품은 가격 정보를 제공하지 않을 수 있습니다.'
                    : '가격 정보를 확인할 수 없습니다.',
            ];
        }

        $deals = $row['deals'] ?? [];
        $deal0 = (is_array($deals) && isset($deals[0]) && is_array($deals[0])) ? $deals[0] : null;

        if (!$deal0) {
            return [
                'source'  => 'isthereanydeal',
                'status'  => 'unavailable',
                'message' => ($kind === 'sub')
                    ? '패키지 상품은 가격 정보를 제공하지 않을 수 있습니다.'
                    : '가격 정보를 확인할 수 없습니다.',
            ];
        }

        $currentAmount   = $deal0['price']['amountInt'] ?? $deal0['price']['amount'] ?? null;
        $currentCurrency = $deal0['price']['currency'] ?? null;
        $regularAmount   = $deal0['regular']['amountInt'] ?? $deal0['regular']['amount'] ?? null;
        $cut             = $deal0['cut'] ?? null;

        $historyAll = $row['historyLow']['all'] ?? null;
        $lowAmount  = $historyAll['amountInt'] ?? $historyAll['amount'] ?? null;
        $lowCurrency= $historyAll['currency'] ?? $currentCurrency;

        $isLowestNow = (
            $currentAmount !== null &&
            $lowAmount !== null &&
            (int)$currentAmount === (int)$lowAmount
        );

        $enriched = $this->extractHistoryLowV1Low($historyLowRow);

        return [
            'source' => 'isthereanydeal',
            'status' => 'available',
            'message' => ($kind === 'sub')
                ? '패키지 상품은 가격 이력 정보를 제공하지 않을 수 있습니다.'
                : null,

            'current' => [
                'amount' => $currentAmount,
                'currency' => $currentCurrency,
                'discount_percent' => $cut,
                'regular_price' => $regularAmount,
                'expiry_at' => $deal0['expiry'] ?? null,
                'shop' => $deal0['shop']['name'] ?? null,
            ],

            'historical_low' => [
                'amount' => $enriched['amount'] ?? $lowAmount,
                'currency' => $enriched['currency'] ?? $lowCurrency,
                'discount_percent' => $enriched['discount_percent'] ?? null,
                'last_seen_at' => $enriched['last_seen_at'] ?? null,
                'shop' => $enriched['shop'] ?? ($deal0['shop']['name'] ?? null),
                'regular_price' => $enriched['regular_price'] ?? null,
                'is_lowest_now' => $isLowestNow,
            ],

            'history_low' => [
                'all' => $row['historyLow']['all'] ?? null,
                'y1'  => $row['historyLow']['y1'] ?? null,
                'm3'  => $row['historyLow']['m3'] ?? null,
            ],

            'links' => [
                'deal' => $deal0['url'] ?? null,
                'game' => null,
            ],
        ];
    }

    private function extractHistoryLowV1Low(?array $historyLowRow): array
    {
        if (is_array($historyLowRow) && isset($historyLowRow[0]['low'])) {
            $low = $historyLowRow[0]['low'];
            return $this->normalizeLow($low);
        }

        if (is_array($historyLowRow) && isset($historyLowRow['low']) && is_array($historyLowRow['low'])) {
            return $this->normalizeLow($historyLowRow['low']);
        }

        if (is_array($historyLowRow) && isset($historyLowRow['price'])) {
            return [
                'amount' => $historyLowRow['price']['amountInt'] ?? $historyLowRow['price']['amount'] ?? null,
                'currency' => $historyLowRow['price']['currency'] ?? null,
                'discount_percent' => $historyLowRow['cut'] ?? null,
                'last_seen_at' => $historyLowRow['timestamp'] ?? null,
                'shop' => $historyLowRow['shop']['name'] ?? null,
                'regular_price' => $historyLowRow['regular']['amountInt'] ?? $historyLowRow['regular']['amount'] ?? null,
            ];
        }

        return [];
    }

    private function normalizeLow(array $low): array
    {
        return [
            'amount' => $low['price']['amountInt'] ?? $low['price']['amount'] ?? null,
            'currency' => $low['price']['currency'] ?? null,
            'discount_percent' => $low['cut'] ?? null,
            'last_seen_at' => $low['timestamp'] ?? null,
            'shop' => $low['shop']['name'] ?? null,
            'regular_price' => $low['regular']['amountInt'] ?? $low['regular']['amount'] ?? null,
        ];
    }
}
