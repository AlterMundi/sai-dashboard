#!/usr/bin/env ts-node
/**
 * Test Configuration Loader
 *
 * This script tests that all environment variables are properly loaded
 * and validates the configuration.
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env
const envPath = resolve(__dirname, '../../.env');
console.log(`📂 Loading environment from: ${envPath}\n`);

config({ path: envPath });

// Test configuration import
console.log('🔧 Testing configuration module import...');
try {
  const configModule = require('../src/config/index');

  console.log('\n✅ Configuration loaded successfully!\n');

  // Display key configuration values (without sensitive data)
  console.log('📊 Configuration Summary:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  console.log('\n🌐 Application:');
  console.log(`  • Environment: ${configModule.appConfig.nodeEnv}`);
  console.log(`  • Port: ${configModule.appConfig.port}`);
  console.log(`  • Base Path: ${configModule.appConfig.basePath}`);

  console.log('\n🔐 Security:');
  console.log(`  • HTTPS Enforced: ${configModule.appConfig.security.enforceHttps}`);
  console.log(`  • Trust Proxy: ${configModule.appConfig.security.trustProxy}`);
  console.log(`  • Session Duration: ${configModule.appConfig.security.sessionDuration}s`);

  console.log('\n🗄️  Database (Dual-Pool Architecture):');
  console.log(`  • N8N DB: ${configModule.n8nDatabaseConfig.database}@${configModule.n8nDatabaseConfig.host}:${configModule.n8nDatabaseConfig.port}`);
  console.log(`  • SAI DB: ${configModule.saiDatabaseConfig.database}@${configModule.saiDatabaseConfig.host}:${configModule.saiDatabaseConfig.port}`);

  console.log('\n🖼️  Image Processing:');
  console.log(`  • Cache Path: ${configModule.cacheConfig.path}`);
  console.log(`  • Base Path: ${configModule.cacheConfig.basePath}`);
  console.log(`  • Thumbnails: ${configModule.cacheConfig.enableThumbnails}`);
  console.log(`  • Max Size: ${(configModule.cacheConfig.maxImageSize / 1024 / 1024).toFixed(2)}MB`);

  console.log('\n📡 SSE (Real-time):');
  console.log(`  • Heartbeat: ${configModule.appConfig.sse.heartbeatInterval}ms`);
  console.log(`  • Max Clients: ${configModule.appConfig.sse.maxClients}`);
  console.log(`  • Debug Mode: ${configModule.appConfig.sse.debug}`);

  console.log('\n🚀 Features:');
  console.log(`  • Image Processing: ${configModule.appConfig.features.imageProcessing}`);
  console.log(`  • Real-time Updates: ${configModule.appConfig.features.realTimeUpdates}`);
  console.log(`  • Export: ${configModule.appConfig.features.exportFunctionality}`);
  console.log(`  • Dev Tools: ${configModule.appConfig.features.devTools}`);

  console.log('\n📝 Logging:');
  console.log(`  • Level: ${configModule.appConfig.logging.level}`);
  console.log(`  • Format: ${configModule.appConfig.logging.format}`);
  console.log(`  • DB Query Logging: ${configModule.appConfig.logging.logDatabaseQueries}`);

  console.log('\n⚙️  SAI Workflow:');
  console.log(`  • Workflow ID: ${configModule.appConfig.sai.workflowId}`);
  console.log(`  • Page Size: ${configModule.appConfig.sai.defaultPageSize}`);
  console.log(`  • Max Page Size: ${configModule.appConfig.sai.maxPageSize}`);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n✅ All configuration validated successfully!\n');

  process.exit(0);
} catch (error) {
  console.error('\n❌ Configuration loading failed!');
  console.error(error);
  process.exit(1);
}
