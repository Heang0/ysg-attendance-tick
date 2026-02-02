const { app, PORT } = require("./app");

app.listen(PORT, () => {
  console.log(`Attendance Tick running on http://localhost:${PORT}`);
});
