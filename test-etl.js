/**
 * Test script for Simple ETL Service
 */

const { SimpleETLService } = require('./backend/dist/services/simple-etl-service.js');

async function testETLService() {
    console.log('🧪 Testing Simple ETL Service...');
    
    const etlService = new SimpleETLService();
    
    try {
        // Start the service
        await etlService.start();
        
        // Wait a moment for initialization
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Test with latest execution
        await etlService.testWithLatestExecution();
        
        // Show metrics
        const metrics = etlService.getMetrics();
        console.log('📊 ETL Metrics:', metrics);
        
        // Stop the service
        await etlService.stop();
        
        console.log('✅ ETL Service test completed successfully');
        
    } catch (error) {
        console.error('❌ ETL Service test failed:', error);
        process.exit(1);
    }
}

testETLService();