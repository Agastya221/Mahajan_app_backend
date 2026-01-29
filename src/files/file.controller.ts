import { Response } from 'express';
import { FileService } from './file.service';
import { presignedUrlRequestSchema, confirmUploadSchema } from './file.dto';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../middleware/auth.middleware';

const fileService = new FileService();

export class FileController {
  requestPresignedUrl = asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = presignedUrlRequestSchema.parse(req.body);
    const result = await fileService.generatePresignedUrl(data, req.user!.id);

    res.status(200).json({
      success: true,
      data: result,
    });
  });

  confirmUpload = asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = confirmUploadSchema.parse(req.body);
    const result = await fileService.confirmUpload(data.fileId, data.s3Key, req.user!.id);

    res.status(200).json({
      success: true,
      data: result,
    });
  });

  getDownloadUrl = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { fileId } = req.params;
    const result = await fileService.generateDownloadUrl(fileId);

    res.json({
      success: true,
      data: result,
    });
  });

  getFileById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { fileId } = req.params;
    const file = await fileService.getFileById(fileId);

    res.json({
      success: true,
      data: file,
    });
  });

  deleteFile = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { fileId } = req.params;
    const result = await fileService.deleteFile(fileId, req.user!.id);

    res.json({
      success: true,
      data: result,
    });
  });
}
