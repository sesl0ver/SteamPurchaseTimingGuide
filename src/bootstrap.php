<?php

use App\Controller\PageController;
use App\Controller\AuthController;
use App\Middleware\ApiJsonResponseMiddleware;
use App\Middleware\ValidateJsonBodyMiddleware;

// Web(HTML)
$app->get('/', PageController::class . ':home');
$app->get('/login', PageController::class . ':login');

// API(JSON)
$app->group('/api', function ($group) {
    $group->post('/login', AuthController::class . ':login')
        ->add(new ValidateJsonBodyMiddleware([
            'email'    => ['required' => true, 'type' => 'string', 'min' => 3, 'max' => 255],
            'password' => ['required' => true, 'type' => 'string', 'min' => 8, 'max' => 72],
        ]));
})->add(new ApiJsonResponseMiddleware());
