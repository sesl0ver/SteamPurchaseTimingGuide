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
        ]);
    }

    public function login(Request $request, Response $response): Response
    {
        return $this->view->render($response, 'login.twig', [
            'title' => 'Login',
        ]);
    }
}
