<?php
global $app;

use App\Controller\HomeController;
use App\Controller\AuthController;
use App\Middleware\ValidateJsonBodyMiddleware;

$app->get('/', HomeController::class . ':index');

$app->post('/login', AuthController::class . ':login')
    ->add(new ValidateJsonBodyMiddleware([
        'email'    => ['required' => true, 'type' => 'string', 'min' => 5, 'max' => 255],
        'password' => ['required' => true, 'type' => 'string', 'min' => 8, 'max' => 72],
    ]));