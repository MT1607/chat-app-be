import { Request, Response, NextFunction, RequestHandler } from 'express';

export interface InternalAuthOptions {
  headerName?: string;
  exemptPaths?: string[];
}

const DEFAULT_HEADER_NAME = 'x-internal-token';

export const createInternalAuthMiddleware = (
  expectedToken: string,
  options: InternalAuthOptions = {}
): RequestHandler => {
  const headerName = options.headerName?.toLowerCase() ?? DEFAULT_HEADER_NAME;
  const exemptPaths = new Set(options.exemptPaths ?? []);

  return (req: Request, res: Response, next: NextFunction) => {
    if (exemptPaths.has(req.path)) {
      next();
      return;
    }

    const token = req.headers[headerName] as string | undefined;
    console.debug(`[InternalAuth] Checking token ${req.headers[headerName]}`);
    if (!token || token !== expectedToken) {
      return res.status(401).json({
        statusCode: 401,
        message: 'Unauthorized: Invalid or missing internal token',
      });
    }

    next();
  };
};
