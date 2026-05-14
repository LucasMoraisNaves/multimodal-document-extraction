export type ApiErrorPayload = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  toJSON(): ApiErrorPayload {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (isErrorWithCode(error, 'FST_REQ_FILE_TOO_LARGE')) {
    return new ApiError(
      413,
      'FILE_TOO_LARGE',
      'O arquivo enviado excede o limite máximo permitido',
      { limit: '20MB' },
    );
  }

  if (error instanceof Error && error.message === 'the request is not multipart') {
    return new ApiError(
      400,
      'MULTIPART_REQUIRED',
      'A requisição deve usar multipart/form-data e enviar o arquivo no campo file',
    );
  }

  return new ApiError(
    500,
    'INTERNAL_ERROR',
    error instanceof Error ? error.message : 'Erro interno inesperado',
  );
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code;
}
