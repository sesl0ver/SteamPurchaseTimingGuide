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
use App\Steam\SteamOpenIdService;
use App\Service\SteamClient;
use App\Service\SteamDealHelper;
use App\Service\ItadClient;
use App\Repository\CommunityKoreanPatchRepository;
use App\Repository\UserRepository;
use App\Repository\WishlistRepository;
use App\Service\CommunityKoreanPatchParser;
use App\Service\LookupHistoryTracker;
use App\Service\AbuseGuard;
use App\Service\StatsTracker;
use App\Middleware\AdminGuardMiddleware;
use GuzzleHttp\Client;
use GuzzleHttp\ClientInterface;
use App\Controller\Api\WishlistController;
use App\Controller\Api\RecentLookupController;
use App\Controller\AuthController;

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
    $appEnv = strtolower((string)($_ENV['APP_ENV'] ?? 'dev'));
    $appDebug = in_array(strtolower((string)($_ENV['APP_DEBUG'] ?? 'true')), ['1','true','yes','on'], true);
    $isProd = ($appEnv === 'prod') && !$appDebug;
    return Twig::create(dirname(__DIR__) . '/templates', [
        'cache' => $isProd ? __DIR__ . '/../var/cache/twig' : false,
        'auto_reload' => !$isProd,
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

$container->set(LookupHistoryTracker::class, function ($c) {
    return new LookupHistoryTracker(
        $c->get(Redis::class),
        $c->get(AbuseGuard::class),
        $c->get(StatsTracker::class),
    );
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

// Steam OpenID (로그인)
$container->set(SteamOpenIdService::class, function ($c) {
    return new SteamOpenIdService($c->get(ClientInterface::class));
});

// User repository (Steam 유저 정보 저장)
$container->set(UserRepository::class, function ($c) {
    return new UserRepository($c->get(PDO::class));
});

// Wishlist repository (찜)
$container->set(WishlistRepository::class, function ($c) {
    return new WishlistRepository($c->get(PDO::class));
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
        $c->get(LookupHistoryTracker::class),
    );
});

$container->set(RecentLookupController::class, function ($c) {
    return new RecentLookupController(
        $c->get(\Redis::class),
        $c->get(StatsTracker::class)
    );
});

$container->set(WishlistController::class, function ($c) {
    return new WishlistController(
        $c->get(WishlistRepository::class),
        $c->get(UserRepository::class),
    );
});

$container->set(AuthController::class, function ($c) {
    return new AuthController(
        $c->get(PDO::class),
        $c->get(UserRepository::class),
        $c->get(WishlistRepository::class),
    );
});

$container->set(App\Service\AbuseGuard::class,
    fn($c) => new App\Service\AbuseGuard($c->get(Redis::class))
);

$container->set(App\Service\StatsTracker::class,
    fn($c) => new App\Service\StatsTracker($c->get(Redis::class))
);

// Slim에 컨테이너 설정
AppFactory::setContainer($container);
$app = AppFactory::create();

// JSON body 파싱
$app->addBodyParsingMiddleware();

// 라우팅
$app->addRoutingMiddleware();

// 에러 미들웨어 + 커스텀 핸들러
// 환경 플래그 (없으면 dev 기본)
// prod에서는 상세 에러 숨김
$displayErrorDetails = (strtolower((string)($_ENV['APP_ENV'] ?? 'dev')) !== 'prod') &&
    in_array(strtolower((string)($_ENV['APP_DEBUG'] ?? 'true')), ['1','true','yes','on'], true);

// 에러 미들웨어 + 커스텀 핸들러
$errorMiddleware = $app->addErrorMiddleware(
    $displayErrorDetails,
    true,   // logErrors
    true    // logErrorDetails
);
$errorMiddleware->setDefaultErrorHandler(ErrorHandler::class);

// 부트스트랩(세션 시작 등)
require __DIR__ . '/../src/bootstrap.php';

$app->run();
