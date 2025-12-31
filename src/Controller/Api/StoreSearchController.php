<?php
declare(strict_types=1);

namespace App\Controller\Api;

use App\Http\ApiResponse;
use App\Service\SteamClient;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

final class StoreSearchController
{
    public function __construct(
        private readonly SteamClient $steamClient
    ) {}

    /**
     * GET /api/storesearch?term=...
     */
    public function search(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $q = $request->getQueryParams();
        $term = trim((string)($q['term'] ?? ''));

        if ($term === '') {
            return ApiResponse::success($response, [
                'total' => 0,
                'items' => [],
            ]);
        }

        $result = $this->steamClient->storeSearch($term, 'KR', 'koreana');

        if (($result['success'] ?? false) !== true) {
            return ApiResponse::error($response, (string)($result['message'] ?? '검색 결과를 불러올 수 없습니다.'), 1001, 502);
        }

        // 프론트가 사용하는 최소 필드만 보장된 payload를 그대로 반환
        return ApiResponse::success($response, [
            'total' => (int)($result['total'] ?? 0),
            'items' => is_array($result['items'] ?? null) ? $result['items'] : [],
        ]);
    }
}
