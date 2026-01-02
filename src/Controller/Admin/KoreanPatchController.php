<?php
declare(strict_types=1);

namespace App\Controller\Admin;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Views\Twig;

/**
 * Admin UI: 커뮤니티 한글패치 관리
 * - 실제 데이터 처리는 /admin/api/korean-patch(JSON)로 위임
 * - 토큰은 쿼리 token 값을 그대로 유지(링크/JS에서 재사용)
 */
final class KoreanPatchController
{
    public function __construct(private readonly Twig $view) {}

    public function page(ServerRequestInterface $req, ResponseInterface $res): ResponseInterface
    {
        $token = (string)($req->getQueryParams()['token'] ?? '');
        return $this->view->render($res, 'admin/korean_patch.twig', [
            'admin_token' => $token,
        ]);
    }
}
