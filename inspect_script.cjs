/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "server/data/custom_scripts.json");

try {
  const data = fs.readFileSync(filePath, "utf8");
  const json = JSON.parse(data);

  // Find the target script
  const scriptId = "1768474387278745";
  const scriptObj = json.admin.js.find((s) => s.id === scriptId);

  if (!scriptObj) {
    console.log("Script not found!");
    process.exit(1);
  }

  const content = scriptObj.content;

  // Find lines creating the link text
  // Look for where the numbers are set.
  // The HTML has `data-index="0">1</a>`, so likely loop index + 1

  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    if (line.includes("innerText") || line.includes("textContent") || line.includes("innerHTML")) {
      // Show context
      console.log(`Line ${idx}: ${line.trim()}`);
    }
    if (line.includes("custom-access-links")) {
      console.log(`Line ${idx} (container): ${line.trim()}`);
    }
  });
} catch (err) {
  console.error(err);
}
