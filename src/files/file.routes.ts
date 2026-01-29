import { Router } from 'express';
import { FileController } from './file.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const fileController = new FileController();

/**
 * @route   POST /api/v1/files/presigned-url
 * @desc    Request presigned URL for file upload
 * @access  Private
 */
router.post('/presigned-url', authenticate, fileController.requestPresignedUrl);

/**
 * @route   POST /api/v1/files/confirm-upload
 * @desc    Confirm file upload completion
 * @access  Private
 */
router.post('/confirm-upload', authenticate, fileController.confirmUpload);

/**
 * @route   GET /api/v1/files/:fileId/download-url
 * @desc    Get presigned download URL
 * @access  Private
 */
router.get('/:fileId/download-url', authenticate, fileController.getDownloadUrl);

/**
 * @route   GET /api/v1/files/:fileId
 * @desc    Get file metadata
 * @access  Private
 */
router.get('/:fileId', authenticate, fileController.getFileById);

/**
 * @route   DELETE /api/v1/files/:fileId
 * @desc    Delete file
 * @access  Private
 */
router.delete('/:fileId', authenticate, fileController.deleteFile);

export default router;
