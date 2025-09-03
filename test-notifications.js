/**
 * Test PostgreSQL NOTIFY system for new executions
 */

const { Client } = require('pg');

async function testNotifications() {
    console.log('📡 Testing PostgreSQL NOTIFY system...');
    
    const client = new Client({
        host: process.env.N8N_DB_HOST || 'localhost',
        port: parseInt(process.env.N8N_DB_PORT || '5432'),
        database: process.env.N8N_DB_NAME || 'n8n',
        user: process.env.N8N_DB_USER || 'n8n_user',
        password: process.env.N8N_DB_PASSWORD || 'a5sd87akdVDS5'
    });
    
    try {
        await client.connect();
        console.log('✅ Connected to n8n database');
        
        // Start listening for notifications
        await client.query('LISTEN sai_execution_ready');
        console.log('👂 Listening for sai_execution_ready notifications...');
        console.log('   Waiting 30 seconds for new SAI executions...');
        console.log('   (Press Ctrl+C to stop)');
        
        let notificationCount = 0;
        
        client.on('notification', (msg) => {
            notificationCount++;
            console.log(`📬 Notification ${notificationCount}:`, {
                channel: msg.channel,
                payload: JSON.parse(msg.payload)
            });
        });
        
        // Wait for 30 seconds
        await new Promise(resolve => setTimeout(resolve, 30000));
        
        if (notificationCount === 0) {
            console.log('ℹ️  No notifications received in 30 seconds');
            console.log('   This is normal if no new SAI executions occurred');
            
            // Test the trigger manually by simulating an update
            console.log('🧪 Testing trigger manually...');
            
            const testResult = await client.query(`
                SELECT test_sai_triggers() as test_result;
            `);
            
            console.log('📊 Trigger Test Results:');
            console.log(testResult.rows[0].test_result);
        }
        
        await client.end();
        console.log('✅ Notification test completed');
        
    } catch (error) {
        console.error('❌ Notification test failed:', error);
        process.exit(1);
    }
}

testNotifications();