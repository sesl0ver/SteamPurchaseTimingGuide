<?php

namespace App\Http;

use Psr\Http\Message\ResponseInterface as Response;

class ApiResponse
{
    public static function success(Response $response, mixed $data = null, string $message = 'OK', int $code = 0, int $status = 200 ): Response
    {
        $payload = [
            'success' => true,
            'code'    => $code,
            'message' => $message,
            'data'    => $data
        ];

        $response->getBody()->write(json_encode($payload));
        return $response->withStatus($status);
    }

    public static function error(Response $response, string $message, int $code = 1000, int $status = 400): Response
    {
        $payload = [
            'success' => false,
            'code'    => $code,
            'message' => $message
        ];

        $response->getBody()->write(json_encode($payload));
        return $response->withStatus($status);
    }

    public static function errorWithDetails(Response $response, string $message, int $code = 1000, int $status = 400, array $details = []): Response {
        $payload = [
            'success' => false,
            'code'    => $code,
            'message' => $message,
        ];

        if (!empty($details)) {
            $payload['errors'] = $details;
        }

        $response->getBody()->write(json_encode($payload));
        return $response->withStatus($status);
    }
}
