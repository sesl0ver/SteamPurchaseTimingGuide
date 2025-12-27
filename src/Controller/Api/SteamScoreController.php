<?php

declare(strict_types=1);

namespace App\Controller\Api;

use App\Http\ApiResponse;
use App\Service\Score\SteamScoreCalculator;
use App\Service\SteamClient;
use Exception;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Throwable;

final readonly class SteamScoreController
{
    // 사용자에게는 일반 메시지로, 내부적으로는 코드로 구분하기 쉽게
    private const int ERR_INVALID_APPID      = 1000;
    private const int ERR_STEAM_APPDATA      = 1001;
    private const int ERR_STEAM_APPDATA_SHAPE= 1002;

    private const int ERR_STEAM_REVIEWS      = 3001;

    public function __construct(
        private SteamClient          $steamClient,
        private SteamScoreCalculator $scoreCalculator,
    ) {}

    public function calculateResult(Request $request, Response $response, array $args): Response
    {
        $appId = (string)($args['appId'] ?? '0');

        if (!$this->isValidAppId($appId)) {
            // ApiJsonResponseMiddleware가 잡는 구조라면, 여기서 던져도 되고
            // 성공/실패 응답을 컨트롤러에서 직접 내려도 됩니다.
            // 현재 스타일에 맞춰 exception 유지.
            throw new Exception('AppID는 숫자여야 합니다.', self::ERR_INVALID_APPID);
        }

        // ------------------------------------------
        // 1) Steam 게임 기본 정보 (필수)
        // ------------------------------------------
        $gameResult = null;

        try {
            $gameResult = $this->steamClient->getAppData($appId);
        } catch (Throwable $e) {
            // 여기서는 필수 데이터이므로 실패 처리
            // (로그 시스템이 있다면 $e를 로깅하세요)
            throw new Exception('게임 정보를 가져오지 못했습니다.', self::ERR_STEAM_APPDATA);
        }

        if (!is_array($gameResult) || empty($gameResult['success'])) {
            // steamClient가 success 플래그를 주는 구조라고 가정
            throw new Exception('게임 정보를 가져오지 못했습니다.', self::ERR_STEAM_APPDATA);
        }

        // 필수 키 방어 (Undefined index 방지)
        foreach (['name', 'header_image', 'price'] as $k) {
            if (!array_key_exists($k, $gameResult)) {
                throw new Exception('게임 정보 응답 형식이 올바르지 않습니다.', self::ERR_STEAM_APPDATA_SHAPE);
            }
        }

        // priceScore는 필수(하지만 price 구조가 null일 수 있으니 방어)
        $priceScore = $this->safePriceScore($gameResult['price']);

        // ------------------------------------------
        // 3) Steam 리뷰 (부분 실패 허용)
        // ------------------------------------------
        $reviewScore = [
            'reviewScore' => 50, // 중립값
        ];

        try {
            $reviewResult = $this->steamClient->getReviews($appId);

            // getReviews() 반환 구조가 무엇이든, 계산기에서 처리 가능하도록 방어
            if (!empty($reviewResult)) {
                $reviewScore = $this->safeReviewScore($reviewResult);
            }
        } catch (Throwable $e) {
            // 부분 실패: 기본 중립점수 유지
        }

        // ------------------------------------------
        // 5) 최종 점수 계산
        // ------------------------------------------
        $finalScore = $this->safeFinalScore(
            ($priceScore['priceScore'] ?? 0),
            ($reviewScore['reviewScore'] ?? 0),
        );

        return ApiResponse::success($response, [
            'appId'       => $appId,
            'game_title'  => (string)$gameResult['name'],
            'game_image'  => (string)$gameResult['header_image'],
            'score'       => [
                ...$priceScore,
                ...$reviewScore,
                ...$finalScore,
            ],
            'generated_at' => time(),
        ]);
    }

    // -------------------------------------------------
    // Helpers
    // -------------------------------------------------

    private function isValidAppId(string $appId): bool
    {
        return $appId !== '' && preg_match('/^\d+$/', $appId) === 1;
    }

    private function safePriceScore(mixed $price): array
    {
        try {
            // 계산기가 null/배열 구조를 안전 처리한다고 가정
            $score = $this->scoreCalculator->priceScore($price);

            // 최소 형태 보장
            return [
                'priceScore' => (int)($score['priceScore'] ?? 0),
            ];
        } catch (Throwable) {
            // 가격 정보를 못 읽어도 전체는 유지
            return ['priceScore' => 50];
        }
    }

    private function safeReviewScore(mixed $reviewResult): array
    {
        try {
            $score = $this->scoreCalculator->reviewScore($reviewResult);

            return [
                'reviewScore' => (int)($score['reviewScore'] ?? 0),
            ];
        } catch (Throwable) {
            return ['reviewScore' => 50];
        }
    }

    private function safeFinalScore(int $priceScore, int $reviewScore): array
    {
        try {
            $score = $this->scoreCalculator->finalScore($priceScore, $reviewScore);

            // finalScore 키를 기대
            return [
                'finalScore' => (int)($score['finalScore'] ?? 0),
            ];
        } catch (Throwable) {
            // 최종점수만 최소 보장
            $avg = (int)round(($priceScore + $reviewScore) / 2);
            return ['finalScore' => $avg];
        }
    }
}
