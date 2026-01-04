<?php
declare(strict_types=1);

namespace App\Controller\Admin\Api;

use App\Http\ApiResponse;
use App\Repository\CommunityKoreanPatchRepository;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Psr7\Response;

/**
 * Admin API(JSON)
 * - /admin/api/korean-patch
 * - 관리자 토큰은 AdminGuardMiddleware에서 이미 검증됨
 */
final class CommunityKoreanPatchApiController
{
    public function __construct(private readonly CommunityKoreanPatchRepository $repo) {}

    public function list(ServerRequestInterface $req, ResponseInterface $res): ResponseInterface
    {
        $q = trim((string)($req->getQueryParams()['q'] ?? ''));
        $page = (int)($req->getQueryParams()['page'] ?? 1);
        $perPage = (int)($req->getQueryParams()['per_page'] ?? 20);

        if ($page < 1) { $page = 1; }
        if ($perPage < 5) { $perPage = 5; }
        if ($perPage > 100) { $perPage = 100; }

        $appIdFilter = null;
        if ($q !== '') {
            // Steam AppID는 숫자만 허용
            if (ctype_digit($q)) {
                $appIdFilter = (int)$q;
            }
        }

        $result = $this->repo->listPaged($page, $perPage, $appIdFilter);

        return ApiResponse::success($res, $result);
    }

    public function get(ServerRequestInterface $req, ResponseInterface $res, array $args): ResponseInterface
    {
        $appId = (int)($args['app_id'] ?? 0);
        $row = $this->repo->findRawByAppId($appId);

        if ($row === null) {
            return ApiResponse::error($res, 'Not found', 404, 404);
        }

        return ApiResponse::success($res, $row);
    }

    public function upsert(ServerRequestInterface $req, ResponseInterface $res): ResponseInterface
    {
        $body = (string)$req->getBody();
        $payload = json_decode($body, true);
        if (!is_array($payload)) {
            return ApiResponse::error($res, 'Invalid JSON', 400, 400);
        }

        $patchText = (string)($payload['patch_text'] ?? '');
        $name = (string)($payload['name'] ?? '');
        $appIdRaw = trim((string)($payload['app_id'] ?? ''));

        if ($appIdRaw === '' || !ctype_digit($appIdRaw)) {
            return ApiResponse::error($res, 'app_id is required', 422, 422);
        }

        $ok = $this->repo->upsertOne((int)$appIdRaw, $name, $patchText);

        return ApiResponse::success($res, [
            'updated' => $ok ? 1 : 0,
        ]);
    }

    public function delete(ServerRequestInterface $req, ResponseInterface $res, array $args): ResponseInterface
    {
        $appId = (int)($args['app_id'] ?? 0);
        $ok = $this->repo->deleteByAppId($appId);

        return ApiResponse::success($res, [
            'deleted' => $ok ? 1 : 0,
        ]);
    }

}
