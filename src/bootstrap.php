<?php

// 세션 시작 (Steam 로그인 상태 유지용)
// - 이미 시작된 경우는 건드리지 않습니다.
// - PHP 기본 세션을 사용합니다(요청사항).
if (session_status() === PHP_SESSION_NONE) {
    // 보수적으로 설정(서비스 환경에 따라 서버 설정이 더 우선될 수 있음)
    ini_set('session.use_strict_mode', '1');
    ini_set('session.cookie_httponly', '1');
    session_start();
}

use App\Controller\AuthController;
use App\Controller\PageController;
use App\Controller\SteamAuthController;
use App\Controller\Api\WishlistController;
use App\Controller\Admin\DashboardController;
use App\Controller\Api\DealController;
use App\Controller\Api\RecentLookupController;
use App\Controller\Api\StoreSearchController;
use App\Middleware\ApiJsonResponseMiddleware;
use App\Middleware\AdminGuardMiddleware;
use App\Middleware\RateLimitMiddleware;
use App\Middleware\AppIdCooldownMiddleware;
use App\Controller\Admin\KoreanPatchController;
use App\Controller\Admin\Api\CommunityKoreanPatchApiController;

// Web(HTML)
$app->get('/', PageController::class . ':home');
$app->get('/app/{id:[0-9]+}', PageController::class . ':home');
$app->get('/sub/{id:[0-9]+}', PageController::class . ':home');
$app->get('/bundle/{id:[0-9]+}', PageController::class . ':home');

$app->get('/login', [PageController::class, 'login']);

// Steam OpenID 로그인
$app->get('/auth/steam/start', SteamAuthController::class . ':start');
$app->get('/auth/steam/callback', SteamAuthController::class . ':callback');
$app->get('/auth/logout', SteamAuthController::class . ':logout');

// 대시보드 메인
$app->get('/dashboard', [PageController::class, 'dashboard']);

// 찜 목록 관리
$app->get('/dashboard/wishlist', [PageController::class, 'wishlistManage']);

// 회원 탈퇴 (POST 권장, 지금은 GET으로 최소 구현)
$app->post('/dashboard/delete', [AuthController::class, 'withdraw']);
// 템플릿/기존 링크 호환: /auth/withdraw
$app->post('/auth/withdraw', [AuthController::class, 'withdraw']);

// 대시보드에서 찜 취소
$app->post('/dashboard/wishlist/remove', [AuthController::class, 'removeWishlist']);

$adminToken = (string)($_ENV['ADMIN_TOKEN'] ?? '');

// Admin(HTML)
$app->group('/admin', function ($group) {
    $group->get('', DashboardController::class);
    $group->get('/korean-patch', [KoreanPatchController::class, 'page']);

    // Admin API(JSON)
    $group->group('/api', function ($api) {
        $api->get('/korean-patch', [CommunityKoreanPatchApiController::class, 'list']);
        $api->get('/korean-patch/{app_id:[0-9]+}', [CommunityKoreanPatchApiController::class, 'get']);
        $api->post('/korean-patch', [CommunityKoreanPatchApiController::class, 'upsert']);
        $api->delete('/korean-patch/{app_id:[0-9]+}', [CommunityKoreanPatchApiController::class, 'delete']);
    })->add(new ApiJsonResponseMiddleware());
})->add(new AdminGuardMiddleware($_ENV['ADMIN_TOKEN'] ?? ''));

// API(JSON)
$app->group('/api', function ($group) {
    $group->get('/recent-lookups', [RecentLookupController::class, 'listRecent']); // 최근 조회 목록

    // Steam Store Search (server proxy)
    $group->get('/storesearch', [StoreSearchController::class, 'search']);

    // Wishlist
    $group->get('/wishlist/status', [WishlistController::class, 'status']);
    $group->get('/wishlist/list', [WishlistController::class, 'list']);
    $group->post('/wishlist/toggle', [WishlistController::class, 'toggle']);
})->add(new ApiJsonResponseMiddleware());

$cooldown = new AppIdCooldownMiddleware(
    $container->get(\Redis::class),
    cooldownSeconds: 10
);
$app->group('/api/deal', function ($group) {
    $group->get('/{steam_appid}', [DealController::class, 'fetchApp']);
    $group->get('/sub/{sub_id}', [DealController::class, 'fetchSub']);
    $group->get('/bundle/{bundle_id}', [DealController::class, 'fetchBundle']);
})->add(function ($request, $handler) use ($container) {
    $redis = $container->get(\Redis::class);
    $mw = new RateLimitMiddleware($redis, limitPerMinute: 8);
    return $mw->process($request, $handler);
})->add($cooldown); // 스팀 패키지
