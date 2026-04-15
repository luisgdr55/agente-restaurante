-- Script de inicialización de PostgreSQL
-- Se ejecuta automáticamente cuando el contenedor arranca por primera vez

-- Extensiones útiles
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- para búsquedas de texto en clientes

-- Configuración de timezone
SET timezone = 'America/Caracas';
