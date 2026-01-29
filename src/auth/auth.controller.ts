import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { registerSchema, loginSchema, refreshTokenSchema } from './auth.dto';
import { asyncHandler } from '../middleware/error.middleware';

const authService = new AuthService();

export class AuthController {
  register = asyncHandler(async (req: Request, res: Response) => {
    const data = registerSchema.parse(req.body);
    const result = await authService.register(data);

    res.status(201).json({
      success: true,
      data: result,
    });
  });

  login = asyncHandler(async (req: Request, res: Response) => {
    const data = loginSchema.parse(req.body);
    const result = await authService.login(data);

    res.json({
      success: true,
      data: result,
    });
  });

  refreshToken = asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = refreshTokenSchema.parse(req.body);
    const result = await authService.refreshToken(refreshToken);

    res.json({
      success: true,
      data: result,
    });
  });

  logout = asyncHandler(async (req: Request, res: Response) => {
    // For JWT, logout is handled on the client by removing the token
    // You could implement token blacklisting here if needed
    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  });
}
