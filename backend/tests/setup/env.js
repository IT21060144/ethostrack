/**
 * Runs before every test file. Fixed test secrets and timings, so the tests
 * never depend on (or touch) the real backend/.env. dotenv does not override
 * variables that are already set, so these win.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.PSEUDONYM_SECRET = 'test-pseudonym-secret';
process.env.HEARTBEAT_INTERVAL_SECONDS = '30';
process.env.SESSION_TIMEOUT_SECONDS = '300';
process.env.IDLE_END_SECONDS = '600';
process.env.PRIVACY_K = '5';
process.env.PRIVACY_EPSILON = '1';
process.env.RESEARCH_TIME_ZONE = 'Asia/Colombo';
process.env.DEFAULT_TARGET_DAYS = '4';
process.env.DEFAULT_MIN_MINUTES = '30';
