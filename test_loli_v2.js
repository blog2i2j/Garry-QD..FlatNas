async function testUrl(url) {
  console.log(`Testing ${url}...`);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    });
    console.log(`Status: ${response.status}`);
    console.log(`Final URL: ${response.url}`);
    console.log(`Content-Type: ${response.headers.get("content-type")}`);
  } catch (e) {
    console.error(`Error fetching ${url}:`, e.message);
    if (e.cause) console.error("Cause:", e.cause);
  }
}

console.log("--- Testing LoliAPI ---");
await testUrl("https://www.loliapi.com/acg/pc/");

console.log("\n--- Testing Bing ---");
await testUrl("https://bing.biturl.top/?resolution=1920&format=image&index=0&mkt=zh-CN");

console.log("\n--- Testing Baidu (Connectivity Check) ---");
await testUrl("https://www.baidu.com");
