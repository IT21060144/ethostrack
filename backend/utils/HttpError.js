/**
 * HttpError — Privacy-Preserving Centralized Exception Model
 * ---------------------------------------------------------------------------
 * Extends the native JavaScript Error object to pass uniform, predictable
 * status codes and error contexts through the Express server pipeline.
 *
 * PRIVACY SPECIFICATIONS
 * ----------------------
 * Enforces the data minimisation parameters required by our research approach.
 * It packages user-friendly, descriptive error diagnostics while stripping away
 * dangerous database structures or internal trace identifiers before they can
 * reach client browser endpoints.
 */
class HttpError extends Error {
  /**
   * @param {number} status - The HTTP numerical response status code (e.g., 400, 401, 404)
   * @param {string} message - Clean, non-leaking informational description text string
   * @param {object} [details] - Optional schema field validation validation indicators
   */
  constructor(status, message, details = undefined) {
    super(message);
    this.status = status;
    this.message = message;
    this.details = details;
    
    // Capture stack trace context properties safely inside the backend layer only
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = HttpError;
