<?php

namespace App\Controller;

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Views\Twig;
use App\Repository\WishlistRepository;
use App\Repository\UserRepository;

final class PageController
{
    // 찜 목록 관리 페이지에서 한 페이지에 보여줄 개수(서버에서 조절)
    private const int WISHLIST_PER_PAGE = 10;

    public function __construct(
        private readonly Twig               $view,
        private readonly WishlistRepository $wishlists,
        private readonly UserRepository     $users,
    ) {}

    public function home(Request $request, Response $response): Response
    {
        return $this->view->render($response, 'home.twig', [
            'title' => 'Home',
            'steam_user' => $_SESSION['steam_user'] ?? null,
        ]);
    }

    public function login(Request $request, Response $response): Response
    {
        return $this->view->render($response, 'login.twig', [
            'title' => 'Login',
            'steam_user' => $_SESSION['steam_user'] ?? null,
            'error' => $request->getQueryParams()['error'] ?? null,
        ]);
    }

    public function dashboard(Request $request, Response $response): Response
    {
        $session = $_SESSION['steam_user'] ?? null;
        if (!$session) {
            return $response->withHeader('Location','/login')->withStatus(302);
        }

        $userId = $this->resolveInternalUserId($session);

        $wishlistTotal = $userId ? $this->wishlists->countByUser($userId) : 0;
        $wishlist = $userId ? $this->wishlists->listByUserPaged($userId, 3, 0) : [];

        return $this->view->render($response, 'dashboard/index.twig', [
            'hide_search' => true,
            'steam_user' => $session,
            'wishlist' => $wishlist,
            'wishlist_total' => $wishlistTotal,
        ]);
    }

    /**
     * 찜 목록 관리 페이지
     * GET /dashboard/wishlist?page=1
     */
    public function wishlistManage(Request $request, Response $response): Response
    {
        $session = $_SESSION['steam_user'] ?? null;
        if (!$session) {
            return $response->withHeader('Location','/login')->withStatus(302);
        }

        $userId = $this->resolveInternalUserId($session);
        if ($userId === null) {
            return $response->withHeader('Location','/login')->withStatus(302);
        }

        $q = $request->getQueryParams();
        $page = isset($q['page']) ? (int)$q['page'] : 1;
        if ($page < 1) $page = 1;

        $perPage = self::WISHLIST_PER_PAGE;
        $total = $this->wishlists->countByUser($userId);
        $totalPages = (int)max(1, (int)ceil($total / max(1, $perPage)));
        if ($page > $totalPages) $page = $totalPages;

        $offset = ($page - 1) * $perPage;
        $items = $this->wishlists->listByUserPaged($userId, $perPage, $offset);

        return $this->view->render($response, 'dashboard/wishlist.twig', [
            'hide_search' => true,
            'steam_user' => $session,
            'wishlist' => $items,
            'wishlist_total' => $total,
            'page' => $page,
            'total_pages' => $totalPages,
            'per_page' => $perPage,
        ]);
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
