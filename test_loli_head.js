
async function testUrl(url) {
    console.log(`Testing HEAD ${url}...`);
    try {
        const response = await fetch(url, { redirect: 'follow', method: 'HEAD' });
        console.log(`HEAD Status: ${response.status}`);
        console.log(`HEAD Final URL: ${response.url}`);
        
        if (!response.ok) {
             console.log("HEAD failed, trying GET...");
             const response2 = await fetch(url, { redirect: 'follow' });
             console.log(`GET Status: ${response2.status}`);
             console.log(`GET Final URL: ${response2.url}`);
        }

    } catch (e) {
        console.error(e);
    }
}

console.log("Starting HEAD tests...");
await testUrl('https://www.loliapi.com/acg/pc/');
await testUrl('https://www.loliapi.com/acg/pe/');
