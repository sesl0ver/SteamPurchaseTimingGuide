<?php

namespace App\Controller\Api;

use App\Http\ApiResponse;
use App\Repository\UserRepository;
use App\Repository\WishlistRepository;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

class WishlistController
{
    public function __construct(
        private WishlistRepository $wishlists,
        private UserRepository $users,
    ) {}

    /**
     * GET /api/wishlist/status?kind=app&id=123
     */
    public function status(Request $request, Response $response): Response
    {
        $session = $_SESSION['steam_user'] ?? null;
        if (!$session) {
            return ApiResponse::success($response, ['wished' => false]);
        }

        $kind = (string)($request->getQueryParams()['kind'] ?? '');
        $id = (string)($request->getQueryParams()['id'] ?? '');

        if (!$this->isValidKind($kind) || $id === '') {
            return ApiResponse::error($response, '요청 값이 올바르지 않습니다.', 1001, 400);
        }

        $userId = $this->resolveInternalUserId($session);
        if ($userId === null) {
            return ApiResponse::success($response, ['wished' => false]);
        }

        $wished = $this->wishlists->exists($userId, $kind, $id);
        return ApiResponse::success($response, ['wished' => $wished]);
    }

    /**
     * POST /api/wishlist/toggle
     * body(json): {kind,id,title,header_image,steam_url}
     */
    public function toggle(Request $request, Response $response): Response
    {
        $session = $_SESSION['steam_user'] ?? null;
        if (!$session) {
            return ApiResponse::error($response, '로그인이 필요합니다.', 1401, 401);
        }

        $body = (array)($request->getParsedBody() ?? []);
        $kind = (string)($body['kind'] ?? '');
        $id = (string)($body['id'] ?? '');
        $title = (string)($body['title'] ?? '');
        $headerImage = (string)($body['header_image'] ?? '');
        $steamUrl = (string)($body['steam_url'] ?? '');

        if (!$this->isValidKind($kind) || $id === '') {
            return ApiResponse::error($response, '요청 값이 올바르지 않습니다.', 1001, 400);
        }

        $userId = $this->resolveInternalUserId($session);
        if ($userId === null) {
            return ApiResponse::error($response, '유저 정보를 확인할 수 없습니다.', 1402, 401);
        }

        $wished = $this->wishlists->toggle(
            $userId,
            $kind,
            $id,
            $title,
            $headerImage,
            $steamUrl,
        );

        return ApiResponse::success($response, ['wished' => $wished]);
    }

    private function isValidKind(string $kind): bool
    {
        return in_array($kind, ['app', 'sub', 'bundle'], true);
    }

    /**
     * @param array<string,mixed> $session
     */
    private function resolveInternalUserId(array $session): ?int
    {
        if (isset($session['id']) && is_numeric($session['id'])) {
            return (int)$session['id'];
        }
        $steamId = (string)($session['steam_id'] ?? '');
        if ($steamId === '') return null;
        $row = $this->users->findBySteamId($steamId);
        return isset($row['id']) ? (int)$row['id'] : null;
    }
}
