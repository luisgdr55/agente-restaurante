-- Script de inicialización de PostgreSQL
-- Se ejecuta automáticamente cuando el contenedor arranca por primera vez

-- Base de datos para Evolution API (separada del bot)
SELECT 'CREATE DATABASE evolution_db OWNER restaurant_user'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'evolution_db')\gexec

-- Extensiones útiles
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- para búsquedas de texto en clientes

-- Configuración de timezone
SET timezone = 'America/Caracas';
