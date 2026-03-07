-- Multi-user schema for PostgreSQL
-- Creates tables for users, provider_connections, api_keys, combos, model_aliases, settings, and usage_history

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE,
  display_name VARCHAR(255),
  oauth_provider VARCHAR(50),
  oauth_id VARCHAR(255),
  tenant_id VARCHAR(255),
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  last_login_at TIMESTAMP,
  UNIQUE(oauth_provider, oauth_id)
);

-- Provider connections table
CREATE TABLE IF NOT EXISTS provider_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  auth_type VARCHAR(20) DEFAULT 'oauth',
  name VARCHAR(255),
  email VARCHAR(255),
  display_name VARCHAR(255),
  priority INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMP,
  token_type VARCHAR(50),
  scope TEXT,
  id_token TEXT,
  project_id VARCHAR(255),
  api_key TEXT,
  test_status VARCHAR(50),
  last_tested TIMESTAMP,
  last_error TEXT,
  last_error_at TIMESTAMP,
  rate_limited_until TIMESTAMP,
  expires_in INTEGER,
  error_code INTEGER,
  consecutive_use_count INTEGER DEFAULT 0,
  global_priority INTEGER,
  default_model VARCHAR(255),
  provider_specific_data JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- API keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  key VARCHAR(255) UNIQUE NOT NULL,
  machine_id VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Combos table
CREATE TABLE IF NOT EXISTS combos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  models JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Model aliases table
CREATE TABLE IF NOT EXISTS model_aliases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  alias VARCHAR(255) NOT NULL,
  model VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, alias)
);

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  cloud_enabled BOOLEAN DEFAULT FALSE,
  tunnel_enabled BOOLEAN DEFAULT FALSE,
  tunnel_url VARCHAR(500),
  sticky_round_robin_limit INTEGER DEFAULT 3,
  require_login BOOLEAN DEFAULT TRUE,
  observability_enabled BOOLEAN DEFAULT TRUE,
  observability_max_records INTEGER DEFAULT 1000,
  observability_batch_size INTEGER DEFAULT 20,
  observability_flush_interval_ms INTEGER DEFAULT 5000,
  observability_max_json_size INTEGER DEFAULT 1024,
  outbound_proxy_enabled BOOLEAN DEFAULT FALSE,
  outbound_proxy_url VARCHAR(500),
  outbound_no_proxy TEXT,
  password VARCHAR(255),
  fallback_strategy VARCHAR(50) DEFAULT 'fill-first',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Usage history table
CREATE TABLE IF NOT EXISTS usage_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  model VARCHAR(255),
  provider VARCHAR(50),
  connection_id UUID,
  tokens JSONB,
  cost DECIMAL(10, 6) DEFAULT 0,
  status VARCHAR(50) DEFAULT 'ok',
  endpoint VARCHAR(255),
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_provider_connections_user_id ON provider_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_provider_connections_provider ON provider_connections(provider);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
CREATE INDEX IF NOT EXISTS idx_combos_user_id ON combos(user_id);
CREATE INDEX IF NOT EXISTS idx_model_aliases_user_id ON model_aliases(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_history_user_id ON usage_history(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_history_timestamp ON usage_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_history_api_key_id ON usage_history(api_key_id);

-- Provider nodes (global, not user-scoped)
CREATE TABLE IF NOT EXISTS provider_nodes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  prefix VARCHAR(50),
  api_type VARCHAR(50),
  base_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Pricing table (global, not user-scoped)
CREATE TABLE IF NOT EXISTS pricing (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(50) NOT NULL,
  model VARCHAR(255) NOT NULL,
  input_cost DECIMAL(10, 6),
  output_cost DECIMAL(10, 6),
  currency VARCHAR(10) DEFAULT 'USD',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(provider, model)
);
