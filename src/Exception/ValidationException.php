<?php

namespace App\Exception;

use RuntimeException;

class ValidationException extends RuntimeException
{
    private array $errors;
    private int $httpStatus;

    public function __construct(
        string $message,
        int $appCode = 1002,
        int $httpStatus = 422,
        array $errors = []
    ) {
        parent::__construct($message, $appCode);
        $this->httpStatus = $httpStatus;
        $this->errors = $errors;
    }

    public function getErrors(): array
    {
        return $this->errors;
    }

    public function getHttpStatus(): int
    {
        return $this->httpStatus;
    }
}
