<?php
declare(strict_types=1);

namespace App\Controller\Api;

use App\Http\ApiResponse;
use App\Service\SteamDealHelper;
use App\Service\LookupHistoryTracker;
use App\Service\Fingerprint;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

final class DealController
{
    public function __construct(
        private readonly SteamDealHelper      $dealHelper,
        private readonly LookupHistoryTracker $historyTracker,
    ) {}

    /**
     * /api/deal/{steam_appid}
     */
    public function fetchApp(
        ServerRequestInterface $request,
        ResponseInterface $response,
        array $args
    ): ResponseInterface {
        $id = (string)($args['steam_appid'] ?? $args['appId'] ?? $args['id'] ?? '');
        if ($id === '' || !preg_match('/^\d+$/', $id)) {
            return ApiResponse::error($response, '유효하지 않은 Steam App ID입니다.', 400, 400);
        }

        $result = $this->dealHelper->build($id, 'KR');
        if ($result === null) {
            return ApiResponse::error($response, '게임 정보를 불러올 수 없습니다.', 404, 404);
        }

        $this->recordTrend($request, $result);

        return ApiResponse::success($response, $result);
    }

    /**
     * /api/deal/sub/{sub_id}
     */
    public function fetchSub(
        ServerRequestInterface $request,
        ResponseInterface $response,
        array $args
    ): ResponseInterface {
        $id = (string)($args['sub_id'] ?? '');
        if ($id === '' || !preg_match('/^\d+$/', $id)) {
            return ApiResponse::error($response, '유효하지 않은 Steam 패키지(Sub) ID입니다.', 400, 400);
        }

        $result = $this->dealHelper->buildSub($id, 'KR');
        if ($result === null) {
            return ApiResponse::error($response, 'Steam 패키지 정보를 불러올 수 없습니다.', 404, 404);
        }

        $this->recordTrend($request, $result);

        return ApiResponse::success($response, $result);
    }

    /**
     * /api/deal/bundle/{bundle_id}
     */
    public function fetchBundle(
        ServerRequestInterface $request,
        ResponseInterface $response,
        array $args
    ): ResponseInterface {
        $id = (string)($args['bundle_id'] ?? '');
        if ($id === '' || !preg_match('/^\d+$/', $id)) {
            return ApiResponse::error($response, '유효하지 않은 Steam 번들(Bundle) ID입니다.', 400, 400);
        }

        $result = $this->dealHelper->buildBundle($id, 'KR');
        if ($result === null) {
            return ApiResponse::error($response, 'Steam 번들 정보를 불러올 수 없습니다.', 404, 404);
        }

        $this->recordTrend($request, $result);

        return ApiResponse::success($response, $result);
    }

    /**
     * 조회 성공 시 트렌드 기록
     */
    private function recordTrend(ServerRequestInterface $request, array $result): void
    {
        $meta = $result['meta'] ?? [];
        $kind = (string)($meta['kind'] ?? '');
        $id = (string)($meta['id'] ?? '');
        $steamUrl = (string)($meta['steam_url'] ?? '');

        $steam = $result['steam'] ?? [];
        $item = $steam[$kind] ?? [];
        $title = (string)($item['title'] ?? '');
        $headerImage = (string)($item['header_image'] ?? '');

        if ($kind !== '' && $id !== '') {
            $this->historyTracker->record(
                Fingerprint::fromRequest($request),
                $kind,
                $id,
                $title,
                $headerImage,
                $steamUrl
            );
        }
    }

}
