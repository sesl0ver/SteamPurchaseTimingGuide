<?php

namespace App\Middleware;

use Slim\Exception\HttpException;
use Slim\Interfaces\ErrorHandlerInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Psr7\Response;
use App\Exception\ValidationException;
use App\Http\ApiResponse;
use Throwable;

class ErrorHandler implements ErrorHandlerInterface
{
    public function __invoke(ServerRequestInterface $request, Throwable $exception, bool $displayErrorDetails, bool $logErrors, bool $logErrorDetails): ResponseInterface
    {
        // ValidationException 우선 처리
        if ($exception instanceof ValidationException) {
            return ApiResponse::errorWithDetails(
                new Response(),
                $exception->getMessage(),
                $exception->getCode(),
                $exception->getHttpStatus(),
                $exception->getErrors()
            );
        }

        $status = $exception instanceof HttpException ? $exception->getCode() : 500;
        $response = new Response();

        return ApiResponse::error($response, $exception->getMessage(), 1001, $status);
    }
}
