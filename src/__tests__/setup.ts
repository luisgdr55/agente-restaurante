// Configurar variables de entorno para tests antes de que se importe env.ts
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.WHATSAPP_TOKEN = 'test-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = '987654321';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-1234567890';
process.env.DASHBOARD_PIN = '123456';
process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-characters-long';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
