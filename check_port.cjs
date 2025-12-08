/* eslint-disable @typescript-eslint/no-require-imports */
const net = require("net");

const ports = [3000, 5173];

ports.forEach((port) => {
  const client = new net.Socket();
  client.setTimeout(1000);

  client.connect(port, "localhost", () => {
    console.log(`Port ${port} is open`);
    client.destroy();
  });

  client.on("error", () => {
    console.log(`Port ${port} is closed`);
    client.destroy();
  });

  client.on("timeout", () => {
    console.log(`Port ${port} timed out`);
    client.destroy();
  });
});
