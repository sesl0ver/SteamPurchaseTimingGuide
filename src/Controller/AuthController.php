<?php

namespace App\Controller;

use App\Http\ApiResponse;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

class AuthController
{
    public function withdraw(Request $request, Response $response): Response
    {
        $user = $_SESSION['steam_user'] ?? null;
        if (!$user) {
            return $response->withHeader('Location', '/login')->withStatus(302);
        }
        $userId = $user['id'];

        // TODO:
        // - users 테이블에서 해당 유저 삭제
        // - wishlist 테이블 삭제 (추후 추가)
        // - 트랜잭션 처리 권장

        session_destroy();
        return $response->withHeader('Location', '/')->withStatus(302);
    }
}
