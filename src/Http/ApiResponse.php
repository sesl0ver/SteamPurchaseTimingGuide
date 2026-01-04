<?php

namespace App\Http;

use Psr\Http\Message\ResponseInterface as Response;

class ApiResponse
{
    public static function success(
        Response $response,
        mixed $data = null,
        string $message = 'OK',
        int $code = 0,
        int $status = 200
    ): Response {
        $payload = [
            'success' => true,
            'code'    => $code,
            'message' => $message,
            'data'    => $data,
        ];

        return self::renderJson($response, $payload, $status);
    }

    public static function error(
        Response $response,
        string $message,
        int $code = 1000,
        int $status = 400
    ): Response {
        $payload = [
            'success' => false,
            'code'    => $code,
            'message' => $message,
        ];

        return self::renderJson($response, $payload, $status);
    }

    public static function errorWithDetails(
        Response $response,
        string $message,
        int $code = 1000,
        int $status = 400,
        array $details = []
    ): Response {
        $payload = [
            'success' => false,
            'code'    => $code,
            'message' => $message,
        ];

        if (!empty($details)) {
            $payload['errors'] = $details;
        }

        return self::renderJson($response, $payload, $status);
    }

    private static function renderJson(Response $response, array $payload, int $status): Response
    {
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false) {
            $json = '{"success":false,"message":"JSON encoding error"}';
        }

        $response->getBody()->write($json);

        return $response
            ->withHeader('Content-Type', 'application/json; charset=utf-8')
            ->withStatus($status);
    }
}
