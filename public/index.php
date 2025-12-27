<?php
declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use App\Middleware\ErrorHandler;
use DI\Container;
use Dotenv\Dotenv;
use Slim\Factory\AppFactory;
use Slim\Views\Twig;
use App\Infrastructure\Database\PdoFactory;
use App\Infrastructure\Cache\RedisFactory;
use App\Infrastructure\Cache\RedisCache;
use App\Controller\Api\DealController;
use App\Steam\SteamWebApiClient;
use App\Steam\SteamService;
use App\Service\SteamClient;
use App\Service\SteamDealHelper;
use App\Service\ItadClient;
use App\Repository\CommunityKoreanPatchRepository;
use App\Service\CommunityKoreanPatchParser;
use GuzzleHttp\Client;
use GuzzleHttp\ClientInterface;

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

$container->set(ClientInterface::class, function () {
    return new Client([
        // 기본값(필요 시)
        'timeout' => 10.0,
    ]);
});


// Twig 등록 (DI로 주입해서 사용)
$container->set(Twig::class, function (): Twig {
    return Twig::create(dirname(__DIR__) . '/templates', [
        'cache' => false, // 운영에서는 캐시 경로 권장
    ]);
});

// PDO 등록 (중요: DSN을 DI가 추론할 수 없으므로 직접 Factory로 생성)
$container->set(PDO::class, function (): PDO {
    return PdoFactory::create();
});

$container->set(CommunityKoreanPatchRepository::class, function ($c) {
    return new CommunityKoreanPatchRepository(
        $c->get(PDO::class)
    );
});

$container->set(CommunityKoreanPatchParser::class, function () {
    return new CommunityKoreanPatchParser();
});

// Redis 등록
$container->set(\Redis::class, function (): \Redis {
    return RedisFactory::create();
});

$container->set(RedisCache::class, function ($c) {
    return new RedisCache($c->get(\Redis::class));
});


$container->set(SteamWebApiClient::class, function () {
    $key = (string)($_ENV['STEAM_WEB_API_KEY'] ?? '');
    if ($key === '') {
        throw new \RuntimeException('Missing env: STEAM_WEB_API_KEY');
    }
    return new SteamWebApiClient($key);
});

$container->set(SteamService::class, function ($c) {
    return new SteamService($c->get(SteamWebApiClient::class));
});

$container->set(SteamClient::class, function ($c) {
    return new SteamClient(
        $c->get(RedisCache::class)
    );
});

$container->set(SteamDealHelper::class, function ($c) {
    return new SteamDealHelper(
        $c->get(SteamClient::class),
        $c->get(ItadClient::class),
        $c->get(CommunityKoreanPatchRepository::class),
        $c->get(CommunityKoreanPatchParser::class),
    );
});

$container->set(ItadClient::class, function ($c) {
    $apiKey = $_ENV['ITAD_API_KEY'] ?? '';
    if ($apiKey === '') {
        throw new \RuntimeException('ITAD_API_KEY is missing in environment (.env)');
    }

    $apiBase = $_ENV['ITAD_API_BASE'] ?? 'https://api.isthereanydeal.com';
    $steamShopId = (int)($_ENV['ITAD_STEAM_SHOP_ID'] ?? 61);

    return new ItadClient(
        $c->get(ClientInterface::class),
        $c->get(RedisCache::class),      // 캐시 안 쓰려면 이 줄과 생성자 인자에서 빼세요
        $apiBase,
        $apiKey,
        $steamShopId
    );
});

$container->set(DealController::class, function ($c) {
    return new DealController(
        $c->get(SteamDealHelper::class),
        $c->get(ItadClient::class),
        $c->get(ClientInterface::class),
    );
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
