<?php
declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use App\Middleware\ErrorHandler;
use DI\Container;
use Dotenv\Dotenv;
use Slim\Factory\AppFactory;
use Slim\Views\Twig;
use App\Infrastructure\Database\PdoFactory;

$dotenv = Dotenv::createImmutable(dirname(__DIR__));
$dotenv->load();
$dotenv->required([
    'DB_HOST',
    'DB_NAME',
    'DB_USER',
    'DB_PASS',
    'STEAM_WEB_API_KEY',
]);

$container = new Container();

// Twig 등록 (DI로 주입해서 사용)
$container->set(Twig::class, function (): Twig {
    return Twig::create(dirname(__DIR__) . '/templates', [
        'cache' => false, // 운영에서는 캐시 경로 권장
    ]);
});

// ✅ PDO 등록 (중요: DSN을 DI가 추론할 수 없으므로 직접 Factory로 생성)
$container->set(PDO::class, function (): PDO {
    return PdoFactory::create();
});

// Slim에 컨테이너 설정
AppFactory::setContainer($container);
$app = AppFactory::create();

// JSON body 파싱
$app->addBodyParsingMiddleware();

// 라우팅
$app->addRoutingMiddleware();

// 에러 미들웨어 + 커스텀 핸들러
$errorMiddleware = $app->addErrorMiddleware(true, true, true);
$errorMiddleware->setDefaultErrorHandler(ErrorHandler::class);

// 부트스트랩(세션 시작 등)
require __DIR__ . '/../src/bootstrap.php';

$app->run();
