import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { mapPgErrorToHttpException } from '../utils/pg-errors';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const mappedPg = exception instanceof HttpException ? null : mapPgErrorToHttpException(exception);
    const resolvedException = mappedPg ?? exception;

    if (resolvedException instanceof HttpException) {
      const status = resolvedException.getStatus();
      const rawResponse = resolvedException.getResponse();

      if (typeof rawResponse === 'object' && rawResponse !== null) {
        res.status(status).json({
          statusCode: status,
          ...rawResponse,
          timestamp: new Date().toISOString(),
          path: req?.url,
        });
        return;
      }

      res.status(status).json({
        statusCode: status,
        message: String(rawResponse),
        timestamp: new Date().toISOString(),
        path: req?.url,
      });
      return;
    }

    const errMsg = exception instanceof Error ? exception.message : String(exception);
    this.logger.error(
      `Excepción no controlada en ${req?.method ?? 'HTTP'} ${req?.url ?? ''}: ${errMsg}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Ocurrió un error interno en el servidor. Por favor, intenta nuevamente.',
      timestamp: new Date().toISOString(),
      path: req?.url,
    });
  }
}
