<?php

namespace App\Middleware;

use App\Exception\ValidationException;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

class ValidateJsonBodyMiddleware implements MiddlewareInterface
{
    public function __construct(private array $rules) {}

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        // Content-Type 강제
        $ct = $request->getHeaderLine('Content-Type');
        if (stripos($ct, 'application/json') === false) {
            throw new ValidationException(
                'Content-Type은 application/json 이어야 합니다.',
                1002,
                415,
                [['field' => 'Content-Type', 'reason' => 'must be application/json']]
            );
        }

        // POST/PUT/PATCH인데 body 비었으면 명확하게 에러 + query 힌트
        $method = strtoupper($request->getMethod());
        $raw = (string)$request->getBody();
        $parsed = $request->getParsedBody();

        if (in_array($method, ['POST', 'PUT', 'PATCH'], true)) {
            if ($parsed === null && trim($raw) === '') {
                $query = $request->getQueryParams();
                $hint = !empty($query)
                    ? 'POST 요청은 Query 파라미터가 아니라 JSON Body로 보내야 합니다.'
                    : 'POST 요청 본문이 비어 있습니다. JSON Body를 보내세요.';

                $errors = [
                    ['field' => '$body', 'reason' => 'body is empty'],
                ];

                if (!empty($query)) {
                    $errors[] = ['field' => '$query', 'reason' => 'query params provided but body expected'];
                }

                throw new ValidationException($hint, 1002, 400, $errors);
            }
        }

        $body = $request->getParsedBody();
        if (!is_array($body)) {
            throw new ValidationException('요청 본문(JSON)이 올바르지 않습니다.', 1002, 422, [
                ['field' => '$body', 'reason' => 'body must be a JSON object'],
            ]);
        }

        // rules 검사
        $errors = [];
        foreach ($this->rules as $field => $rule) {
            $required = (bool)($rule['required'] ?? false);
            $exists = array_key_exists($field, $body);

            if ($required && !$exists) {
                $errors[] = ['field' => $field, 'reason' => 'required'];
                continue;
            }
            if (!$exists) continue;

            $value = $body[$field];

            if (isset($rule['type'])) {
                $type = $rule['type'];
                $ok = match ($type) {
                    'string' => is_string($value),
                    'int'    => is_int($value),
                    'bool'   => is_bool($value),
                    'array'  => is_array($value),
                    default  => true,
                };
                if (!$ok) {
                    $errors[] = ['field' => $field, 'reason' => "type must be {$type}"];
                    continue;
                }
            }

            if (is_string($value)) {
                if (isset($rule['min']) && mb_strlen($value) < (int)$rule['min']) {
                    $errors[] = ['field' => $field, 'reason' => "min length {$rule['min']}"];
                }
                if (isset($rule['max']) && mb_strlen($value) > (int)$rule['max']) {
                    $errors[] = ['field' => $field, 'reason' => "max length {$rule['max']}"];
                }
            }

            if (is_int($value)) {
                if (isset($rule['min']) && $value < (int)$rule['min']) {
                    $errors[] = ['field' => $field, 'reason' => "min {$rule['min']}"];
                }
                if (isset($rule['max']) && $value > (int)$rule['max']) {
                    $errors[] = ['field' => $field, 'reason' => "max {$rule['max']}"];
                }
            }
        }

        if (!empty($errors)) {
            throw new ValidationException('요청 파라미터가 유효하지 않습니다.', 1002, 422, $errors);
        }

        // 검증 완료 데이터 전달
        $request = $request->withAttribute('validated', $body);
        return $handler->handle($request);
    }
}
