const https = require('https');
require('dotenv').config();

const authKey = process.env.MSG91_AUTH_KEY;
console.log('Testing Auth Key:', authKey ? authKey.substring(0, 6) + '...' : 'MISSING');

const options = {
    hostname: 'control.msg91.com',
    path: '/api/v5/balance',
    method: 'GET',
    headers: {
        'authkey': authKey,
        'Content-Type': 'application/json'
    }
};

const req = https.request(options, (res) => {
    console.log(`Status Code: ${res.statusCode}`);
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        console.log('Response:', data);
    });
});

req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
});

req.end();
