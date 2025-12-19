<?php

namespace App\Controller;

use App\Http\ApiResponse;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

class AuthController
{
    public function login(Request $request, Response $response): Response
    {
        $v = $request->getAttribute('validated'); // 검증 완료 데이터
        return ApiResponse::success($response, [
            'email' => $v['email'],
        ]);
    }
}
