<?php

namespace App\Middleware;

use App\Exception\ValidationException;
use App\Http\ApiResponse;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Exception\HttpException;
use Slim\Interfaces\ErrorHandlerInterface;
use Slim\Psr7\Response;
use Slim\Views\Twig;
use Throwable;

class ErrorHandler implements ErrorHandlerInterface
{
    public function __construct(private Twig $view) {}

    public function __invoke(
        ServerRequestInterface $request,
        Throwable $exception,
        bool $displayErrorDetails,
        bool $logErrors,
        bool $logErrorDetails
    ): ResponseInterface {
        $path = $request->getUri()->getPath();
        $isApi = str_starts_with($path, '/api');

        // API(JSON)
        if ($isApi) {
            if ($exception instanceof ValidationException) {
                $details = $exception->getErrors();
                if ($displayErrorDetails) {
                    $details[] = ['field' => '$trace', 'reason' => $exception->getTraceAsString()];
                }

                return ApiResponse::errorWithDetails(
                    new Response(),
                    $exception->getMessage(),
                    $exception->getCode(),
                    $exception->getHttpStatus(),
                    $details
                );
            }

            $status = ($exception instanceof HttpException) ? ($exception->getCode() ?: 500) : 500;
            $message = $displayErrorDetails ? $exception->getMessage() : 'Internal Server Error';

            $details = $displayErrorDetails
                ? [['field' => '$trace', 'reason' => $exception->getTraceAsString()]]
                : [];

            return ApiResponse::errorWithDetails(new Response(), $message, 1001, $status, $details);
        }

        // WEB(HTML)
        $status = ($exception instanceof HttpException) ? ($exception->getCode() ?: 500) : 500;
        $message = $displayErrorDetails ? $exception->getMessage() : '문제가 발생했습니다.';

        $response = new Response($status);
        return $this->view->render($response, 'error.twig', [
            'title' => 'Error',
            'message' => $message,
        ]);
    }
}
