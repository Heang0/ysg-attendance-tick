require("dotenv").config();
process.env.TZ = process.env.TZ || process.env.APP_TZ;
const { app, PORT } = require("./app");

app.listen(PORT, () => {
  console.log(`Attendance Tick running on http://localhost:${PORT}`);
});
