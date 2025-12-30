<?php
declare(strict_types=1);

namespace App\Middleware;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Slim\Psr7\Response;

final class AdminGuardMiddleware implements MiddlewareInterface
{
    private string $token;

    public function __construct(string $token)
    {
        $this->token = $token;
    }

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        // 쿼리 또는 헤더에서 토큰 받기
        $query = $request->getQueryParams();
        $inputToken = $query['token']
            ?? $request->getHeaderLine('X-Admin-Token')
            ?? '';

        if ($this->token === '' || !hash_equals($this->token, (string)$inputToken)) {
            $res = new Response(403);
            $res->getBody()->write('Forbidden');
            return $res;
        }

        return $handler->handle($request);
    }
}
