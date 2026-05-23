import type { Request, Response } from 'express';

export const getUsersController = async (req: Request, res: Response) => {
  // TODO: Implement get users logic
  res.json({
    message: 'Get users endpoint',
    data: [],
  });
};
