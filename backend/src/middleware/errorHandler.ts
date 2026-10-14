import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  details?: unknown;
}

export const errorHandler = (
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const statusCode = err.statusCode || 500;
  const publicMessages: Record<number, string> = {
    400: 'Invalid request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
    409: 'Conflict', 413: 'Request body too large', 429: 'Too many requests',
  };
  const message = publicMessages[statusCode] || 'Request failed';

  // Log a safe error category; raw messages and stacks can contain private data.
  if (statusCode >= 500) {
    logger.error({ err }, 'unhandled request error');
  }

  // Prisma-specific error handling
  if (err.code === 'P2002') {
    res.status(409).json({
      error: 'Conflict',
      message: 'A record with this unique field already exists',
    });
    return;
  }

  if (err.code === 'P2025') {
    res.status(404).json({
      error: 'Not Found',
      message: 'Record not found',
    });
    return;
  }

  res.status(statusCode).json({
    error: statusCode >= 500 ? 'Internal Server Error' : message,
    message: statusCode >= 500 ? 'An unexpected error occurred' : message,
  });
};

export const notFound = (_req: Request, res: Response): void => {
  res.status(404).json({
    error: 'Not Found',
    message: 'Route not found',
  });
};

export const createError = (message: string, statusCode: number = 500): AppError => {
  const error: AppError = new Error(message);
  error.statusCode = statusCode;
  return error;
};
