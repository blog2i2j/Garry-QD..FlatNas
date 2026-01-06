async function testLogin(password) {
  try {
    const res = await fetch("http://localhost:3000/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password }),
    });
    const data = await res.json();
    console.log(`Login with "${password}":`, res.status, data);
  } catch (e) {
    console.error("Error:", e);
  }
}

testLogin("admin");
