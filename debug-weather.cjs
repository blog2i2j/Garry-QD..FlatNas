const http = require('http');

const city = encodeURIComponent('宁波市');
const url = `http://localhost:3000/api/weather?city=${city}&source=wttr`;

console.log(`Testing URL: ${url}`);
const start = Date.now();

const req = http.get(url, (res) => {
  console.log(`Status Code: ${res.statusCode}`);
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log(`Time taken: ${Date.now() - start}ms`);
    console.log('Response Body:', data);
  });

});

req.on('error', (err) => {
  console.error(`Error after ${Date.now() - start}ms:`, err.message);
});

req.end();
