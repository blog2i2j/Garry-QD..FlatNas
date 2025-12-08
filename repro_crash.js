
const url = "https://gitee.com/gjx0808/FlatNas";

async function test() {
  console.log("Fetching", url);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); 

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    clearTimeout(timeout);

    console.log("Status:", response.status);
    if (!response.ok) throw new Error("Failed to fetch");

    const html = await response.text();
    console.log("HTML length:", html.length);

    // Extract Title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "";
    console.log("Title:", title);

    // Extract Icon
    const iconMatch = html.match(
      /<link[^>]+rel=["'](?:shortcut\s+)?icon["'][^>]+href=["']([^"']+)["']/i,
    );
    if (iconMatch) {
      console.log("Icon:", iconMatch[1]);
    }
    
    console.log("Done");
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
