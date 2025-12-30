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
                /*if ($displayErrorDetails) {
                    $details[] = ['field' => '$trace', 'reason' => $exception->getTraceAsString()];
                }*/

                return ApiResponse::errorWithDetails(
                    new Response(),
                    $exception->getMessage(),
                    1200, // $exception->getCode()
                    $exception->getHttpStatus(),
                    $details
                );
            }

            $code = ($exception instanceof HttpException) ? (int)$exception->getCode() : 0;
            $status = ($code >= 400 && $code < 600) ? $code : 500;
            $message = $displayErrorDetails ? $exception->getMessage() : 'Internal Server Error';

            $details = [];
            /*$details = $displayErrorDetails
                ? [['field' => '$trace', 'reason' => $exception->getTraceAsString()]]
                : [];*/

            $errorCode = 1001;

            if ($exception instanceof HttpException) {
                $errorCode = match ($status) {
                    404 => 1404,
                    405 => 1405,
                    default => 1400,
                };
            }

            return ApiResponse::errorWithDetails(new Response(), $message, $errorCode, $status, $details);
        }

        // WEB(HTML)
        $code = ($exception instanceof HttpException) ? (int)$exception->getCode() : 0;
        $status = ($code >= 400 && $code < 600) ? $code : 500;
        $message = $displayErrorDetails ? $exception->getMessage() : match ($status) {
            404 => '페이지를 찾을 수 없습니다.',
            405 => '허용되지 않은 요청입니다.',
            default => '문제가 발생했습니다.',
        };

        $response = new Response($status);
        return $this->view->render($response, 'error.twig', [
            'title' => 'Error',
            'message' => $message,
        ]);
    }
}
