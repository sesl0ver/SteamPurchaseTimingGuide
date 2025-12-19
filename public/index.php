<?php
require __DIR__ . '/../vendor/autoload.php';

use DI\Container;
use Slim\Factory\AppFactory;
use Slim\Views\Twig;

$container = new Container();

// Twig 등록 (DI로 주입해서 사용)
$container->set(Twig::class, function () {
    return Twig::create(__DIR__ . '/../templates', [
        'cache' => false, // 운영에서는 캐시 경로 권장
    ]);
});

AppFactory::setContainer($container);

$app = AppFactory::create();

// JSON body 파싱
$app->addBodyParsingMiddleware();

// 라우팅
$app->addRoutingMiddleware();

// 에러 미들웨어 + 커스텀 핸들러(컨테이너에서 생성 -> Twig 주입 가능)
$errorMiddleware = $app->addErrorMiddleware(true, true, true);
$errorMiddleware->setDefaultErrorHandler(\App\Middleware\ErrorHandler::class);

require __DIR__ . '/../src/bootstrap.php';

$app->run();
