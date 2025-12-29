<?php

use App\Controller\PageController;
use App\Controller\AuthController;
use App\Controller\Api\DealController;
use App\Controller\Api\TrendingController;
use App\Middleware\ApiJsonResponseMiddleware;
use App\Middleware\ValidateJsonBodyMiddleware;

// Web(HTML)
$app->get('/', PageController::class . ':home');
$app->get('/login', PageController::class . ':login');

// API(JSON)
$app->group('/api', function ($group) {
    // 로그인 TODO 차후 업데이트를 위한 참고용 API
    $group->post('/login', AuthController::class . ':login')
        ->add(new ValidateJsonBodyMiddleware([
            'email'    => ['required' => true, 'type' => 'string', 'min' => 3, 'max' => 255],
            'password' => ['required' => true, 'type' => 'string', 'min' => 8, 'max' => 72],
        ]));

    $group->get('/deal/{steam_appid}', [DealController::class, 'fetchApp']); // 스팀 기본 앱
    $group->get('/deal/sub/{sub_id}', [DealController::class, 'fetchSub']); // 스팀 패키지
    $group->get('/deal/bundle/{bundle_id}', [DealController::class, 'fetchBundle']); // 스팀 패키지
    $group->get('/trending', [TrendingController::class, 'list']); // 최근 조회 상위
})->add(new ApiJsonResponseMiddleware());
