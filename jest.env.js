// Variables de entorno para tests — archivo JS puro (no TS) para garantizar carga antes de ts-jest
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.WHATSAPP_TOKEN = 'test-whatsapp-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = '987654321';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
process.env.OPENROUTER_API_KEY = 'sk-or-test-key-1234567890';
process.env.LLM_MODEL = 'google/gemini-2.0-flash-001';
process.env.DASHBOARD_PIN = '123456';
process.env.JWT_SECRET = 'supersecretjwtsecretkey32charslong!';
process.env.JWT_EXPIRES_IN = '7d';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
