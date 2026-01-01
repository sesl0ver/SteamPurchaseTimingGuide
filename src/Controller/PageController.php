<?php

namespace App\Controller;

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Views\Twig;
use App\Repository\WishlistRepository;
use App\Repository\UserRepository;

class PageController
{
    public function __construct(
        private Twig $view,
        private WishlistRepository $wishlists,
        private UserRepository $users,
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
        $wishlist = $userId ? $this->wishlists->listByUser($userId) : [];

        return $this->view->render($response, 'dashboard/index.twig', [
            'hide_search' => true,
            'steam_user' => $session,
            'wishlist' => $wishlist,
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
