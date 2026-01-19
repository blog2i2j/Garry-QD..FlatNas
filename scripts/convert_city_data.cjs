/* eslint-disable @typescript-eslint/no-require-imports */
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const inputFile = "C:\\Users\\80425\\Downloads\\AMap_adcode_citycode_20210406.xlsx";
const outputFile = path.join(__dirname, "../src/assets/city-data.json");

// Create assets dir if not exists
const assetsDir = path.dirname(outputFile);
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

console.log(`Reading ${inputFile}...`);
const workbook = XLSX.readFile(inputFile);
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const rawData = XLSX.utils.sheet_to_json(worksheet);

// rawData is array of { '中文名': '...', 'adcode': '...', 'citycode': '...' }

const provinces = [];
const cityMap = {}; // adcode -> object

// Pass 1: Create all objects
rawData.forEach((row) => {
  const name = row["中文名"];
  const adcode = String(row["adcode"]); // Ensure string

  if (adcode === "100000") return; // Skip Country root

  const item = {
    label: name,
    value: adcode,
    children: [],
  };
  cityMap[adcode] = item;
});

// Pass 2: Build Tree
Object.keys(cityMap).forEach((adcode) => {
  const item = cityMap[adcode];
  const numCode = parseInt(adcode, 10);

  if (adcode.endsWith("0000")) {
    // Province
    provinces.push(item);
  } else if (adcode.endsWith("00")) {
    // City
    const provinceCode = Math.floor(numCode / 10000) * 10000;
    const parent = cityMap[String(provinceCode)];
    if (parent) {
      parent.children.push(item);
    } else {
      // Fallback: Treat as province? Or orphan.
      console.warn(`Orphan City: ${item.label} (${adcode})`);
      provinces.push(item);
    }
  } else {
    // District
    const cityCode = Math.floor(numCode / 100) * 100;
    let parent = cityMap[String(cityCode)];

    if (!parent) {
      // Try Province as parent (Directly controlled counties)
      const provinceCode = Math.floor(numCode / 10000) * 10000;
      parent = cityMap[String(provinceCode)];
    }

    if (parent) {
      parent.children.push(item);
    } else {
      console.warn(`Orphan District: ${item.label} (${adcode})`);
    }
  }
});

// Cleanup: Remove empty children arrays to reduce JSON size
const cleanup = (items) => {
  items.forEach((item) => {
    if (item.children.length === 0) {
      delete item.children;
    } else {
      cleanup(item.children);
    }
  });
};

cleanup(provinces);

console.log(`Writing to ${outputFile}...`);
fs.writeFileSync(outputFile, JSON.stringify(provinces, null, 2));
console.log("Done.");
