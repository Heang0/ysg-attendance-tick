CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS ticks (
  id SERIAL PRIMARY KEY,
  employee TEXT NOT NULL REFERENCES employees(name) ON DELETE CASCADE,
  date DATE NOT NULL,
  slot TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  ip TEXT,
  user_agent TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ticks_unique
  ON ticks (employee, date, slot);
