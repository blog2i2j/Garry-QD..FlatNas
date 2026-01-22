/* eslint-disable @typescript-eslint/no-require-imports */
const XLSX = require('xlsx');
const workbook = XLSX.readFile('C:\\Users\\80425\\Downloads\\AMap_adcode_citycode_20210406.xlsx');
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
console.log(data[0]); // Print header
console.log(data[1]); // Print first row
