<?php

namespace App\Controller;

use App\Repository\UserRepository;
use App\Repository\WishlistRepository;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use PDO;

final class AuthController
{
    public function __construct(
        private readonly PDO                $pdo,
        private readonly UserRepository     $users,
        private readonly WishlistRepository $wishlists,
    ) {}

    public function withdraw(Request $request, Response $response): Response
    {
        $user = $_SESSION['steam_user'] ?? null;
        if (!$user) {
            return $response->withHeader('Location', '/login')->withStatus(302);
        }
        $internalUserId = $this->resolveInternalUserId($user);
        if ($internalUserId === null) {
            // 세션이 깨졌거나 users 테이블이 없으면 안전하게 로그아웃 처리
            session_destroy();
            return $response->withHeader('Location', '/')->withStatus(302);
        }

        // 회원 탈퇴: 유저 정보 + 찜 목록 모두 삭제
        // - 트랜잭션으로 묶어서 원자성 보장
        $this->pdo->beginTransaction();
        try {
            // FK가 ON DELETE CASCADE여도 명시적으로 지웁니다(요구사항).
            $this->wishlists->deleteByUser($internalUserId);
            $stmt = $this->pdo->prepare('DELETE FROM users WHERE id = :id');
            $stmt->execute([':id' => $internalUserId]);

            $this->pdo->commit();
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }

        session_destroy();
        return $response->withHeader('Location', '/')->withStatus(302);
    }

    /**
     * 대시보드에서 찜 취소
     * POST /dashboard/wishlist/remove
     */
    public function removeWishlist(Request $request, Response $response): Response
    {
        $user = $_SESSION['steam_user'] ?? null;
        if (!$user) {
            return $response->withHeader('Location', '/login')->withStatus(302);
        }
        $internalUserId = $this->resolveInternalUserId($user);
        if ($internalUserId === null) {
            return $response->withHeader('Location', '/dashboard')->withStatus(302);
        }

        $data = (array)($request->getParsedBody() ?? []);
        $kind = (string)($data['kind'] ?? '');
        $id = (string)($data['id'] ?? '');
        $returnUrl = (string)($data['return_url'] ?? '');
        if (!in_array($kind, ['app','sub','bundle'], true) || $id === '') {
            return $response->withHeader('Location', $this->safeReturnUrl($request, $returnUrl))->withStatus(302);
        }

        $this->wishlists->deleteOne($internalUserId, $kind, $id);
        return $response->withHeader('Location', $this->safeReturnUrl($request, $returnUrl))->withStatus(302);
    }

    /**
     * 내부 경로로만 리다이렉트(오픈 리다이렉트 방지)
     */
    private function safeReturnUrl(Request $request, string $returnUrl): string
    {
        $returnUrl = trim($returnUrl);
        if ($returnUrl !== '' && str_starts_with($returnUrl, '/')) {
            // 관리 페이지로 돌아가야 하는 경우를 우선 처리
            if (str_starts_with($returnUrl, '/dashboard/wishlist')) {
                return $returnUrl;
            }
        }

        // return_url이 없으면 Referer를 보고 관리 페이지면 그대로 유지
        $referer = (string)($request->getHeaderLine('Referer') ?? '');
        if ($referer !== '') {
            $path = (string)(parse_url($referer, PHP_URL_PATH) ?? '');
            $query = (string)(parse_url($referer, PHP_URL_QUERY) ?? '');
            if ($path === '/dashboard/wishlist') {
                return $query !== '' ? ($path . '?' . $query) : $path;
            }
        }

        return '/dashboard';
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
