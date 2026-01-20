async function testUrl(url) {
  console.log(`Testing ${url}...`);
  try {
    const response = await fetch(url, { redirect: "manual" });
    console.log(`Status: ${response.status}`);
    // console.log(`Headers:`, response.headers);
    if (response.status >= 300 && response.status < 400) {
      console.log(`Location: ${response.headers.get("location")}`);
    }

    // Try following redirect
    const response2 = await fetch(url, { redirect: "follow" });
    console.log(`Final URL: ${response2.url}`);
    console.log(`Final Status: ${response2.status}`);
  } catch (e) {
    console.error(e);
  }
}

console.log("Starting tests...");
await testUrl("https://www.loliapi.com/acg/pc/");
await testUrl("https://www.loliapi.com/acg/pe/");
