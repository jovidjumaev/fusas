const crypto = require('crypto');
const QRCode = require('qrcode');

/**
 * Standardized QR Code Generator for FSAS
 * All QR codes use this unified structure and generation method
 */
class QRCodeGenerator {
  static get QR_SECRET() {
    return process.env.QR_SECRET || 'fsas_qr_secret_key_2024_secure';
  }
  
  static get QR_EXPIRY_SECONDS() {
    return 30; // 30 seconds - security feature to prevent cheating
  }

  /**
   * Generate a secure QR code for a class session
   * @param {string} sessionId - The session ID
   * @returns {Promise<Object>} QR code data with image and metadata
   */
  static async generateSecureQR(sessionId) {
    try {
      const timestamp = Date.now();
      const nonce = crypto.randomBytes(16).toString('hex');
      const qrCodeSecret = crypto.randomBytes(32).toString('hex');
      
      // Create the data to be signed (without the secret since it's not sent to client)
      const data = `${sessionId}-${timestamp}-${nonce}`;
      
      // Generate HMAC signature
      const signature = crypto
        .createHmac('sha256', this.QR_SECRET)
        .update(data)
        .digest('hex');

      // Standardized QR data structure
      const qrData = {
        sessionId,
        timestamp,
        nonce,
        signature,
        expiresAt: new Date(timestamp + (this.QR_EXPIRY_SECONDS * 1000)).toISOString()
      };

      // Create a URL that students can scan directly
      // Use the computer's IP address instead of localhost for phone access
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://156.143.93.115:3000';
      const qrUrl = `${baseUrl}/student/scan?data=${encodeURIComponent(JSON.stringify(qrData))}`;

      // Generate QR code image with the URL
      const qrCodeImage = await QRCode.toDataURL(qrUrl, {
        errorCorrectionLevel: 'M',
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        },
        width: 256
      });

      return {
        qr_code: qrCodeImage,
        qr_data: qrData,
        expires_at: qrData.expiresAt,
        session_id: sessionId,
        secret: qrCodeSecret
      };
    } catch (error) {
      console.error('❌ Error generating QR code:', error);
      throw error;
    }
  }

  /**
   * Validate a scanned QR code
   * @param {Object} qrData - The QR code data to validate
   * @returns {Object} Validation result
   */
  static validateQR(qrData) {
    try {
      // Validate required fields
      if (!qrData || typeof qrData !== 'object') {
        return {
          isValid: false,
          error: 'Invalid QR code format'
        };
      }
      
      const requiredFields = ['sessionId', 'timestamp', 'nonce', 'signature', 'expiresAt'];
      for (const field of requiredFields) {
        if (!qrData[field]) {
          return {
            isValid: false,
            error: `Missing required field: ${field}`
          };
        }
      }
      
      // Validate timestamp is a number
      if (typeof qrData.timestamp !== 'number' || qrData.timestamp <= 0) {
        return {
          isValid: false,
          error: 'Invalid timestamp format'
        };
      }
      
      // Check if QR code has expired
      const now = Date.now();
      const expiresAt = new Date(qrData.expiresAt).getTime();
      
      if (isNaN(expiresAt)) {
        return {
          isValid: false,
          error: 'Invalid expiry date format'
        };
      }
      
      if (now > expiresAt) {
        return {
          isValid: false,
          error: 'QR code has expired'
        };
      }

      // Check if QR code is within valid time window (30 seconds)
      const currentTime = Date.now();
      const qrTimestamp = qrData.timestamp;
      
      if (currentTime - qrTimestamp > 30000) {
        return {
          isValid: false,
          error: 'QR code is too old'
        };
      }

      // Validate HMAC signature
      const data = `${qrData.sessionId}-${qrData.timestamp}-${qrData.nonce}`;
      const expectedSignature = crypto
        .createHmac('sha256', this.QR_SECRET)
        .update(data)
        .digest('hex');
      
      if (expectedSignature !== qrData.signature) {
        return {
          isValid: false,
          error: 'Invalid QR code signature'
        };
      }

      return {
        isValid: true,
        sessionId: qrData.sessionId,
        timestamp: qrData.timestamp
      };
    } catch (error) {
      console.error('❌ Error validating QR code:', error);
      return {
        isValid: false,
        error: 'Invalid QR code format'
      };
    }
  }

  /**
   * Generate a simple rotating QR code (for 30-second intervals)
   * @param {string} sessionId - The session ID
   * @returns {Object} Simple QR data for rotation
   */
  static generateRotatingQR(sessionId) {
    const timestamp = Math.floor(Date.now() / 30000) * 30000; // 30-second intervals
    const data = `${sessionId}:${timestamp}`;
    const secret = crypto.createHmac('sha256', this.QR_SECRET)
      .update(data)
      .digest('hex');
    
    return {
      secret,
      expires_at: new Date(timestamp + 30000).toISOString(),
      data,
      sessionId,
      timestamp
    };
  }
}

module.exports = QRCodeGenerator;
