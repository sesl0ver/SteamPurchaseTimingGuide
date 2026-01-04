<?php
declare(strict_types=1);

namespace App\Controller\Admin;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Views\Twig;

/**
 * Admin UI: 회원 관리
 */
final class UserController
{
    public function __construct(private readonly Twig $view) {}

    public function page(ServerRequestInterface $req, ResponseInterface $res): ResponseInterface
    {
        $token = (string)($req->getQueryParams()['token'] ?? '');
        return $this->view->render($res, 'admin/user.twig', [
            'admin_token' => $token,
        ]);
    }
}
