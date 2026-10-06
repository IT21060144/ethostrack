/**
 * authMiddleware — Token Validation Gateway (Identity Zone)
 * ---------------------------------------------------------------------------
 * Intercepts incoming requests to extract and verify the student's JSON Web Token.
 * 
 * PRIVACY NOTES
 * -------------
 * This middleware acts as the outer shield of the system. It handles the raw
 * identity context (decoded.id), attaching it strictly as a temporary string
 * key on the request context object (req.user). It never exposes passwords, 
 * email parameters, or demographic records to downstream tracking controllers.
 */
const jwt = require('jsonwebtoken');
const HttpError = require('../utils/HttpError');

/**
 * protect — Secure Authentication Middleware Shield
 */
const protect = async (req, res, next) => {
  let token;

  // 1. Check for token presence in standard Authorization headers
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      // Extract token value from "Bearer <token>" formatting layout string
      token = req.headers.authorization.split(' ')[1];

      // 2. Decode and verify signature string against server keys
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

      // 3. Attach the secure account identifier context reference safely
      req.user = { id: decoded.id };
      
      return next();
    } catch (error) {
      // Expected after a JWT_SECRET change or an old login; the client signs out.
      console.warn(`[Auth] Rejected token (${error.message}); client will be asked to log in again.`);
      return next(new HttpError(401, 'Your session has ended. Please log in again.'));
    }
  }

  // If token is missing entirely from execution headers
  if (!token) {
    return next(new HttpError(401, 'Not authorized, token missing'));
  }
};

module.exports = { protect };
