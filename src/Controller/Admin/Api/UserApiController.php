<?php
declare(strict_types=1);

namespace App\Controller\Admin\Api;

use App\Http\ApiResponse;
use App\Repository\UserRepository;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Admin API(JSON): 회원 관리
 */
final class UserApiController
{
    public function __construct(private readonly UserRepository $repo) {}

    public function list(ServerRequestInterface $req, ResponseInterface $res): ResponseInterface
    {
        $q = trim((string)($req->getQueryParams()['q'] ?? ''));
        $page = (int)($req->getQueryParams()['page'] ?? 1);
        $perPage = (int)($req->getQueryParams()['per_page'] ?? 20);

        if ($page < 1) { $page = 1; }
        if ($perPage < 5) { $perPage = 5; }
        if ($perPage > 100) { $perPage = 100; }

        $result = $this->repo->listPaged($page, $perPage, $q !== '' ? $q : null);

        return ApiResponse::success($res, $result);
    }

    public function delete(ServerRequestInterface $req, ResponseInterface $res, array $args): ResponseInterface
    {
        $id = (string)($args['id'] ?? '');
        if ($id === '' || !ctype_digit($id)) {
            return ApiResponse::error($res, 'Invalid ID', 400, 400);
        }

        $ok = $this->repo->deleteById($id);

        return ApiResponse::success($res, [
            'deleted' => $ok ? 1 : 0,
        ]);
    }
}
