<?php

use App\Controller\Api\PingController;
use App\Controller\PageController;
use App\Controller\Api\DealController;
use App\Controller\Api\TrendingController;
use App\Controller\Admin\DashboardController;
use App\Middleware\ApiJsonResponseMiddleware;
use App\Middleware\AdminGuardMiddleware;
use App\Middleware\RateLimitMiddleware;
use App\Middleware\AppIdCooldownMiddleware;

// Web(HTML)
$app->get('/', PageController::class . ':home');
$app->get('/login', PageController::class . ':login');

$adminToken = (string)($_ENV['ADMIN_TOKEN'] ?? '');
$app->get('/admin', DashboardController::class)->add(new AdminGuardMiddleware($_ENV['ADMIN_TOKEN'] ?? ''));

// API(JSON)
$app->group('/api', function ($group) {
    /* 로그인 TODO 차후 업데이트를 위한 참고용 API
    $group->post('/login', AuthController::class . ':login')
        ->add(new ValidateJsonBodyMiddleware([
            'email'    => ['required' => true, 'type' => 'string', 'min' => 3, 'max' => 255],
            'password' => ['required' => true, 'type' => 'string', 'min' => 8, 'max' => 72],
        ]));*/

    $group->post('/ping', PingController::class); // 스팀 기본 앱
    $group->get('/trending', [TrendingController::class, 'list']); // 최근 조회 상위
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
