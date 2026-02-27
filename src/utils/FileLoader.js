/**
 * util/FileLoader.js
 * Hybrid File Manager (Local + S3 Support)
 */

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const mime = require('mime-types');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// --- CONFIGURATION ---
const USE_S3 = process.env.USE_S3 === 'true';
const STORAGE_PATH = path.join(__dirname, '../../storage/uploads'); // Local folder

// Ensure local folder exists
if (!USE_S3) fs.ensureDirSync(STORAGE_PATH);

// Initialize S3 (Only if enabled)
const s3 = USE_S3 ? new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
}) : null;

const BUCKET = process.env.AWS_BUCKET_NAME;

class FileLoader {

    /**
     * UPLOAD FILE
     * Automatically saves to Local or S3 based on config.
     * @param {Buffer|string} fileInput - Buffer or Base64 string
     * @param {string} filename - Optional specific name
     * @returns {Promise<string>} - The unique file key/name
     */
    async upload(fileInput, filename = null) {
        let buffer;
        let contentType;
        let key;

        // 1. Process Input (Base64 vs Buffer)
        if (typeof fileInput === 'string' && fileInput.startsWith('data:')) {
            const matches = fileInput.match(/^data:([a-zA-Z0-9-]+\/[a-zA-Z0-9-+.]+);base64,(.+)$/);
            if (!matches) throw new Error('Invalid Base64');
            contentType = matches[1];
            buffer = Buffer.from(matches[2], 'base64');
            key = filename || this._generateHashName(buffer, contentType);
        } 
        else if (Buffer.isBuffer(fileInput)) {
            buffer = fileInput;
            contentType = mime.lookup(filename) || 'application/octet-stream';
            key = filename || this._generateHashName(buffer, contentType);
        } else {
            throw new Error('Unknown file input');
        }

        // 2. Storage Logic
        if (USE_S3) {
            await s3.send(new PutObjectCommand({
                Bucket: BUCKET,
                Key: key,
                Body: buffer,
                ContentType: contentType
            }));
        } else {
            // Local Storage
            const filePath = path.join(STORAGE_PATH, key);
            await fs.outputFile(filePath, buffer);
        }

        return key;
    }

    /**
     * STREAM FILE (The "Hidden Location" Feature)
     * Pipes the file data directly to the user response.
     * @param {string} key - The filename
     * @returns {Promise<{ stream: ReadableStream, mime: string, size: number }>}
     */
    async getFileStream(key) {
        // Security: Prevent Directory Traversal (e.g. ../../passwd)
        const safeKey = path.basename(key);

        if (USE_S3) {
            try {
                const command = new GetObjectCommand({ Bucket: BUCKET, Key: safeKey });
                const response = await s3.send(command);
                return {
                    stream: response.Body,
                    mime: response.ContentType,
                    size: response.ContentLength
                };
            } catch (e) {
                return null; // File not found on S3
            }
        } else {
            // Local Storage
            const filePath = path.join(STORAGE_PATH, safeKey);
            
            if (!fs.existsSync(filePath)) return null;

            const stat = fs.statSync(filePath);
            const stream = fs.createReadStream(filePath);
            const mimeType = mime.lookup(filePath) || 'application/octet-stream';

            return {
                stream: stream,
                mime: mimeType,
                size: stat.size
            };
        }
    }

    /**
     * DELETE FILE
     */
    async delete(key) {
        const safeKey = path.basename(key);
        
        if (USE_S3) {
            await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: safeKey }));
        } else {
            const filePath = path.join(STORAGE_PATH, safeKey);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        return true;
    }

    // Helper: Create unique hash names
    _generateHashName(buffer, mimeType) {
        const ext = mime.extension(mimeType) || 'bin';
        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        return `${hash}.${ext}`;
    }
}

module.exports = new FileLoader();