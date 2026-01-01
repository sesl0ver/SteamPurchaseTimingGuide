<?php

namespace App\Controller;

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Views\Twig;

class PageController
{
    public function __construct(private Twig $view) {}

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

        return $this->view->render($response, 'dashboard/index.twig', [
            'hide_search' => true,
            'steam_user' => $session,
        ]);
    }
}
