<?php
declare(strict_types=1);

namespace App\Controller\Api;

use App\Service\Fingerprint;
use Redis;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

final class PingController
{
    public function __construct(
        private readonly Redis $redis
    ) {}

    public function __invoke(ServerRequestInterface $req, ResponseInterface $res): ResponseInterface
    {
        $fp = Fingerprint::fromRequest($req);
        $key = 'stats:ccu:' . date('YmdHi');

        $this->redis->sAdd($key, $fp);
        $this->redis->expire($key, 180);

        $res->getBody()->write(json_encode(['ok' => true]));
        return $res->withHeader('Content-Type', 'application/json');
    }
}
