import { Router } from 'express';
import multer from 'multer';
import { FileController } from './file.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const fileController = new FileController();

// Multer configuration for memory storage (file in buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (_req, file, cb) => {
    // Allow images, documents, and audio
    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      // Audio types for voice messages
      'audio/aac',
      'audio/mp4',
      'audio/mpeg',
      'audio/ogg',
      'audio/webm',
      'audio/wav',
      'audio/x-m4a',
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type'));
    }
  },
});

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
 * @route   POST /api/v1/files/upload-compressed
 * @desc    Upload file with server-side compression (for images)
 * @access  Private
 * @body    multipart/form-data with:
 *          - file: The file to upload
 *          - filename: (optional) Override filename
 *          - mimeType: (optional) Override MIME type
 *          - purpose: (optional) LOAD_CARD | RECEIVE_CARD | INVOICE | CHAT_ATTACHMENT
 *          - skipCompression: (optional) Set to 'true' to skip compression
 */
router.post(
  '/upload-compressed',
  authenticate,
  upload.single('file'),
  fileController.uploadCompressed
);

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
