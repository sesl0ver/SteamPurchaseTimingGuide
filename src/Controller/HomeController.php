<?php

namespace App\Controller;

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use App\Http\ApiResponse;

class HomeController
{
    public function index(Request $request, Response $response): Response
    {
        return ApiResponse::success($response, ['message' => 'Hello world!']);
    }
}